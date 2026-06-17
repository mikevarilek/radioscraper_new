import { Song } from '../src/model/song';

function makeSong(artist: string, title: string, album?: string): Song {
  const s = new Song();
  s.artist = artist;
  s.title = title;
  if (album !== undefined) s.album = album;
  return s;
}

describe('Song.toSearchString()', () => {
  describe('album handling', () => {
    it('includes album when all fields are present', () => {
      const s = makeSong('The Killers', 'Mr. Brightside', 'Hot Fuss');
      expect(s.toSearchString()).toBe('artist:The Killers track:Mr. Brightside album:Hot Fuss');
    });

    it('omits album when album is undefined', () => {
      const s = makeSong('The Killers', 'Mr. Brightside');
      expect(s.toSearchString()).toBe('artist:The Killers track:Mr. Brightside');
    });

    it('omits album when album is the string "undefined"', () => {
      const s = makeSong('The Killers', 'Mr. Brightside', 'undefined');
      expect(s.toSearchString()).toBe('artist:The Killers track:Mr. Brightside');
    });

    it('strips "- EP" suffix from album', () => {
      const s = makeSong('Wet Leg', 'Chaise Longue', 'Wet Leg - EP');
      expect(s.toSearchString()).toBe('artist:Wet Leg track:Chaise Longue album:Wet Leg ');
    });

    it('strips the first apostrophe from album', () => {
      const s = makeSong('Someone', 'A Track', "Rock'n'Roll Night");
      expect(s.toSearchString()).toBe("artist:Someone track:A Track album:Rockn'Roll Night");
    });
  });

  describe('artist handling', () => {
    it('uses only the text before a slash in the artist field', () => {
      const s = makeSong('Arcade Fire/Win Butler', 'Wake Up');
      expect(s.toSearchString()).toBe('artist:Arcade Fire track:Wake Up');
    });

    it('preserves surrounding whitespace when splitting on slash', () => {
      const s = makeSong('Simon / Garfunkel', 'The Sound of Silence');
      expect(s.toSearchString()).toBe('artist:Simon  track:The Sound of Silence');
    });

    it('strips the first apostrophe from artist', () => {
      const s = makeSong("Guns N' Roses", 'Paradise City');
      expect(s.toSearchString()).toBe('artist:Guns N Roses track:Paradise City');
    });

    it('only removes the first apostrophe when artist has multiple', () => {
      const s = makeSong("It's O'Clock", 'Some Song');
      expect(s.toSearchString()).toBe("artist:Its O'Clock track:Some Song");
    });

    it('applies slash split before apostrophe removal', () => {
      const s = makeSong("N'Sync/Justin Timberlake", 'Bye Bye Bye');
      expect(s.toSearchString()).toBe("artist:NSync track:Bye Bye Bye");
    });
  });

  describe('title handling', () => {
    it('strips the first apostrophe from title', () => {
      const s = makeSong('Queen', "Don't Stop Me Now");
      expect(s.toSearchString()).toBe('artist:Queen track:Dont Stop Me Now');
    });

    it('only removes the first apostrophe in title', () => {
      const s = makeSong('Someone', "It's Rock'n'Roll");
      expect(s.toSearchString()).toBe("artist:Someone track:Its Rock'n'Roll");
    });
  });

  describe('combined transformations', () => {
    it('applies slash, apostrophe, and album EP strip together', () => {
      const s = makeSong("N'Sync/BSB", "Don't Go", "Summer Hits - EP");
      expect(s.toSearchString()).toBe('artist:NSync track:Dont Go album:Summer Hits ');
    });

    it('handles artist with no slash and no apostrophe unchanged', () => {
      const s = makeSong('Radiohead', 'Creep', 'Pablo Honey');
      expect(s.toSearchString()).toBe('artist:Radiohead track:Creep album:Pablo Honey');
    });
  });
});
