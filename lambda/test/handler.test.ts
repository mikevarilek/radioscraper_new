/**
 * Handler integration tests.
 *
 * External dependencies (Spotify, axios/SiriusXM, DynamoDB mapper, secrets) are
 * all mocked so the tests run without any network or AWS access.
 */

// ── Secrets (file is gitignored; virtual mock so Jest doesn't error) ──────────
jest.mock('../src/secrets', () => ({
  Secrets: {
    SPOTIFY_CLIENT_ID: 'test-client-id',
    SPOTIFY_API_KEY: 'test-api-key',
    SPOTIFY_PLAYLIST_ID: 'test-playlist-id',
  },
}), { virtual: true });

// ── DDB mapper ────────────────────────────────────────────────────────────────
jest.mock('../src/ddb', () => ({
  mapper: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

// ── axios Axios class ─────────────────────────────────────────────────────────
jest.mock('axios', () => ({
  Axios: jest.fn(),
}));

// ── spotify-web-api-node ──────────────────────────────────────────────────────
jest.mock('spotify-web-api-node', () => jest.fn());

// ── imports (after mocks are registered) ─────────────────────────────────────
import { handler } from '../src/index';
import { mapper } from '../src/ddb';
import { Song } from '../src/model/song';

// ── typed access to mocks ─────────────────────────────────────────────────────
const mockMapper = jest.mocked(mapper) as unknown as { get: jest.Mock; put: jest.Mock };

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build the SiriusXM JSON payload the handler receives via axios. */
function siriusXMSongResponse(artist: string, title: string, album: string): string {
  return JSON.stringify({
    channels: {
      altnation: {
        content: {
          type: 'Song',
          artists: [{ name: artist }],
          title,
          album: { title: album },
        },
      },
    },
  });
}

/** A SiriusXM payload that signals "no song is playing right now". */
const siriusXMNonSongResponse = JSON.stringify({
  channels: {
    altnation: {
      content: {
        type: 'Show',
        artists: [{ name: 'alt nation' }],
      },
    },
  },
});

/** A SiriusXM payload with an unexpected structure. */
const siriusXMInvalidResponse = JSON.stringify({ unexpected: true });

function makeSpotifyTrack(
  uri: string,
  name: string,
  explicit: boolean,
  artists: Array<{ name: string }>,
) {
  return { uri, name, explicit, artists };
}

function invoke(): Promise<void> {
  // Handler ignores all lambda arguments; cast to satisfy TypeScript.
  return (handler as any)();
}

// ── test setup ────────────────────────────────────────────────────────────────

let mockSpotify: {
  clientCredentialsGrant: jest.Mock;
  setAccessToken: jest.Mock;
  setRefreshToken: jest.Mock;
  refreshAccessToken: jest.Mock;
  searchTracks: jest.Mock;
  addTracksToPlaylist: jest.Mock;
  authorizationCodeGrant: jest.Mock;
};

let mockAxiosGet: jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();

  // Set up a fresh spotify instance returned by the constructor.
  mockSpotify = {
    clientCredentialsGrant: jest.fn().mockResolvedValue({ body: { access_token: 'cred_token' } }),
    setAccessToken: jest.fn(),
    setRefreshToken: jest.fn(),
    refreshAccessToken: jest.fn().mockResolvedValue({ body: { access_token: 'refreshed_token' } }),
    searchTracks: jest.fn(),
    addTracksToPlaylist: jest.fn().mockResolvedValue({}),
    authorizationCodeGrant: jest.fn(),
  };
  const SpotifyWebApi = require('spotify-web-api-node') as jest.Mock;
  SpotifyWebApi.mockImplementation(() => mockSpotify);

  // Set up the axios get mock.
  mockAxiosGet = jest.fn();
  const { Axios } = require('axios') as { Axios: jest.Mock };
  Axios.mockImplementation(() => ({ get: mockAxiosGet }));

  // Default DDB put succeeds silently.
  mockMapper.put.mockResolvedValue(undefined);
});

/** Wire mapper.get so the first call (refresh_token lookup) succeeds, and the
 *  second call (song lookup) resolves or rejects as requested. */
function setupMapper({
  songAlreadyExists,
}: {
  songAlreadyExists: boolean;
}) {
  const refreshTokenSong = Object.assign(new Song(), {
    artist: 'refresh_token',
    title: 'refresh_token',
    album: 'my_spotify_refresh_token',
  });

  if (songAlreadyExists) {
    const existingSong = Object.assign(new Song(), {
      artist: 'Test Artist',
      title: 'Test Song',
      album: 'Test Album',
    });
    mockMapper.get
      .mockResolvedValueOnce(refreshTokenSong)
      .mockResolvedValueOnce(existingSong);
  } else {
    mockMapper.get
      .mockResolvedValueOnce(refreshTokenSong)
      .mockRejectedValueOnce({ name: 'ItemNotFoundException' });
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('handler – Spotify authentication', () => {
  it('always calls clientCredentialsGrant and refreshAccessToken', async () => {
    setupMapper({ songAlreadyExists: true });
    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('Artist', 'Title', 'Album'),
    });

    await invoke();

    expect(mockSpotify.clientCredentialsGrant).toHaveBeenCalledTimes(1);
    expect(mockSpotify.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockSpotify.setRefreshToken).toHaveBeenCalledWith('my_spotify_refresh_token');
  });
});

describe('handler – song already in DDB', () => {
  it('skips Spotify search and DDB put when song is already stored', async () => {
    setupMapper({ songAlreadyExists: true });
    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('Radiohead', 'Creep', 'Pablo Honey'),
    });

    await invoke();

    expect(mockSpotify.searchTracks).not.toHaveBeenCalled();
    expect(mockSpotify.addTracksToPlaylist).not.toHaveBeenCalled();
    expect(mockMapper.put).not.toHaveBeenCalled();
  });
});

describe('handler – new song (not yet in DDB)', () => {
  it('searches Spotify and adds the track to the playlist and DDB', async () => {
    setupMapper({ songAlreadyExists: false });
    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('Radiohead', 'Creep', 'Pablo Honey'),
    });

    const track = makeSpotifyTrack('spotify:track:abc', 'Creep', false, [{ name: 'Radiohead' }]);
    mockSpotify.searchTracks.mockResolvedValue({
      statusCode: 200,
      body: { tracks: { items: [track] } },
    });

    await invoke();

    expect(mockSpotify.searchTracks).toHaveBeenCalledTimes(1);
    expect(mockSpotify.addTracksToPlaylist).toHaveBeenCalledWith(
      'test-playlist-id',
      ['spotify:track:abc'],
    );
    expect(mockMapper.put).toHaveBeenCalledTimes(1);
  });

  it('passes a correctly built search string to Spotify', async () => {
    setupMapper({ songAlreadyExists: false });
    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('The Killers', 'Mr. Brightside', 'Hot Fuss'),
    });

    const track = makeSpotifyTrack('spotify:track:xyz', 'Mr. Brightside', false, [{ name: 'The Killers' }]);
    mockSpotify.searchTracks.mockResolvedValue({
      statusCode: 200,
      body: { tracks: { items: [track] } },
    });

    await invoke();

    expect(mockSpotify.searchTracks).toHaveBeenCalledWith(
      'artist:The Killers track:Mr. Brightside album:Hot Fuss',
    );
  });

  describe('track selection when Spotify returns multiple results', () => {
    const artists = [{ name: 'Some Artist' }];

    it('prefers the explicit track when track0 is non-explicit, track1 is explicit, and they share name + artists', async () => {
      setupMapper({ songAlreadyExists: false });
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: siriusXMSongResponse('Some Artist', 'Some Song', 'Some Album'),
      });

      const track0 = makeSpotifyTrack('spotify:track:clean', 'Some Song', false, artists);
      const track1 = makeSpotifyTrack('spotify:track:explicit', 'Some Song', true, artists);
      mockSpotify.searchTracks.mockResolvedValue({
        statusCode: 200,
        body: { tracks: { items: [track0, track1] } },
      });

      await invoke();

      expect(mockSpotify.addTracksToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        ['spotify:track:explicit'],
      );
    });

    it('uses the first result when both tracks are explicit', async () => {
      setupMapper({ songAlreadyExists: false });
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: siriusXMSongResponse('Some Artist', 'Some Song', 'Some Album'),
      });

      const track0 = makeSpotifyTrack('spotify:track:first', 'Some Song', true, artists);
      const track1 = makeSpotifyTrack('spotify:track:second', 'Some Song', true, artists);
      mockSpotify.searchTracks.mockResolvedValue({
        statusCode: 200,
        body: { tracks: { items: [track0, track1] } },
      });

      await invoke();

      expect(mockSpotify.addTracksToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        ['spotify:track:first'],
      );
    });

    it('uses the first result when both tracks are non-explicit', async () => {
      setupMapper({ songAlreadyExists: false });
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: siriusXMSongResponse('Some Artist', 'Some Song', 'Some Album'),
      });

      const track0 = makeSpotifyTrack('spotify:track:first', 'Some Song', false, artists);
      const track1 = makeSpotifyTrack('spotify:track:second', 'Some Song', false, artists);
      mockSpotify.searchTracks.mockResolvedValue({
        statusCode: 200,
        body: { tracks: { items: [track0, track1] } },
      });

      await invoke();

      expect(mockSpotify.addTracksToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        ['spotify:track:first'],
      );
    });

    it('uses the first result when track names differ', async () => {
      setupMapper({ songAlreadyExists: false });
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: siriusXMSongResponse('Some Artist', 'Some Song', 'Some Album'),
      });

      const track0 = makeSpotifyTrack('spotify:track:first', 'Some Song', false, artists);
      const track1 = makeSpotifyTrack('spotify:track:second', 'Some Song (Live)', true, artists);
      mockSpotify.searchTracks.mockResolvedValue({
        statusCode: 200,
        body: { tracks: { items: [track0, track1] } },
      });

      await invoke();

      expect(mockSpotify.addTracksToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        ['spotify:track:first'],
      );
    });
  });

  it('throws when Spotify returns zero results', async () => {
    setupMapper({ songAlreadyExists: false });
    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('Unknown Artist', 'Unknown Song', 'Unknown Album'),
    });

    mockSpotify.searchTracks.mockResolvedValue({
      statusCode: 200,
      body: { tracks: { items: [] } },
    });

    await expect(invoke()).rejects.toThrow('Spotify searchTracks no results');
    expect(mockMapper.put).not.toHaveBeenCalled();
  });

  it('throws when Spotify returns a non-200 status code', async () => {
    setupMapper({ songAlreadyExists: false });
    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('Unknown Artist', 'Unknown Song', 'Unknown Album'),
    });

    mockSpotify.searchTracks.mockResolvedValue({
      statusCode: 401,
      body: {},
    });

    await expect(invoke()).rejects.toThrow();
    expect(mockMapper.put).not.toHaveBeenCalled();
  });
});

describe('handler – remaster filtering', () => {
  const remasterTitles = [
    'Mr. Brightside (2004 Remaster)',
    'Some Song - Remastered 2011',
    'Track Name [REMASTER]',
    'Song (remaster)',
  ];

  remasterTitles.forEach(title => {
    it(`never calls Spotify or DDB put for "${title}"`, async () => {
      // Provide mock values for both possible mapper.get calls so the test
      // does not depend on whether the early-return fires before the second call.
      setupMapper({ songAlreadyExists: true });
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: siriusXMSongResponse('Some Artist', title, 'Some Album'),
      });

      await invoke();

      expect(mockSpotify.searchTracks).not.toHaveBeenCalled();
      expect(mockSpotify.addTracksToPlaylist).not.toHaveBeenCalled();
      expect(mockMapper.put).not.toHaveBeenCalled();
    });
  });
});

describe('handler – SiriusXM response variations', () => {
  it('completes without error when the channel is playing a non-song (e.g. show promo)', async () => {
    // No song → mapper.get for refresh_token only; no song lookup.
    const refreshTokenSong = Object.assign(new Song(), {
      artist: 'refresh_token',
      title: 'refresh_token',
      album: 'my_spotify_refresh_token',
    });
    mockMapper.get.mockResolvedValueOnce(refreshTokenSong);
    mockAxiosGet.mockResolvedValue({ status: 200, data: siriusXMNonSongResponse });

    await expect(invoke()).resolves.toBeUndefined();
    expect(mockSpotify.searchTracks).not.toHaveBeenCalled();
    expect(mockMapper.put).not.toHaveBeenCalled();
  });

  it('throws when SiriusXM returns an unexpected response structure', async () => {
    const refreshTokenSong = Object.assign(new Song(), {
      artist: 'refresh_token',
      title: 'refresh_token',
      album: 'my_spotify_refresh_token',
    });
    mockMapper.get.mockResolvedValueOnce(refreshTokenSong);
    mockAxiosGet.mockResolvedValue({ status: 200, data: siriusXMInvalidResponse });

    await expect(invoke()).rejects.toThrow('Not a song or an invalid response.');
  });
});

describe('handler – DDB error propagation', () => {
  it('rethrows non-ItemNotFoundException errors from the DDB song lookup', async () => {
    const refreshTokenSong = Object.assign(new Song(), {
      artist: 'refresh_token',
      title: 'refresh_token',
      album: 'my_spotify_refresh_token',
    });
    mockMapper.get
      .mockResolvedValueOnce(refreshTokenSong)
      .mockRejectedValueOnce({ name: 'ProvisionedThroughputExceededException' });

    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: siriusXMSongResponse('Artist', 'Title', 'Album'),
    });

    await expect(invoke()).rejects.toMatchObject({ name: 'ProvisionedThroughputExceededException' });
    expect(mockSpotify.searchTracks).not.toHaveBeenCalled();
  });
});
