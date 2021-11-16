import { ScheduledHandler } from 'aws-lambda'
import { Axios } from 'axios'
import { mapper } from './ddb'
import { Song } from './model/song'
import { Secrets } from './secrets'
var SpotifyWebApi = require('spotify-web-api-node')

export const handler: ScheduledHandler = async () => {

    var spotifyApi = new SpotifyWebApi({
        clientId: Secrets.SPOTIFY_CLIENT_ID,
        clientSecret: Secrets.SPOTIFY_API_KEY,
        redirectUri: 'http://localhost:3000/',
    });

    // Likely unnecessary, remove later
    await spotifyApi.clientCredentialsGrant().then(
        function(data: { body: { [x: string]: any } }) {
          spotifyApi.setAccessToken(data.body['access_token']);
        },
        function(err: any) {
          console.log('Something went wrong when retrieving an access token', err);
          throw new Error(err);
        }
      );

    let access_token = new Song();
    access_token.artist = "access_token";
    access_token.title = "access_token";

    let refresh_token = new Song();
    refresh_token.artist = "refresh_token";
    refresh_token.title = "refresh_token";

    refresh_token = await mapper.get(refresh_token);

    // Only used if the refresh_token is no longer authorized
    // Requires manually getting a code and putting it in DDB, use link in secrets.ts
    if (refresh_token.album === "empty") {
        access_token = await mapper.get(access_token);
        await spotifyApi.authorizationCodeGrant(access_token.album).then(
            function(data: { body: { [x: string]: any } }) {
                spotifyApi.setAccessToken(data.body['access_token']);
                access_token.album = data.body['access_token'];
                spotifyApi.setRefreshToken(data.body['refresh_token']);
                refresh_token.album = data.body['refresh_token'];
            },
            function(err: string | undefined) {
                console.error(err);
                throw new Error(err);
            }
        );
        await mapper.put(access_token);
        await mapper.put(refresh_token);
    } else {
        spotifyApi.setRefreshToken(refresh_token.album);
    }

    await spotifyApi.refreshAccessToken().then(
        function(data: { body: { [x: string]: any } }) {
            spotifyApi.setAccessToken(data.body['access_token']);
        },
        function(err: string | undefined) {
            console.error(err);
            throw new Error(err);
        }
    )

    let axios = new Axios({});

    let resp = await axios.get("https://www.siriusxm.com/servlet/Satellite?d=&pagename=SXM%2FServices%2FMountainWrapper&desktop=yes&channels=altnation");
    console.info("siriusXM status code " + resp.status);
    let response = JSON.parse(resp.data.toString());
    if (response?.channels?.altnation?.content?.type && 
        response.channels.altnation.content.type === "Song") {
        let song = new Song();
        song.artist = response.channels.altnation.content.artists[0].name;
        song.title = response.channels.altnation.content.title;
        song.album = response.channels.altnation.content.album.title;

        await mapper.get(song).then((alreadyExists: Song) => {
            console.info("Song already in DDB: " + JSON.stringify(alreadyExists));
        }).catch(async error => {
            if (error.name != "ItemNotFoundException") {
                console.error(error);
                throw error;
            }
            // Retrieve and add to spotify before writing to DDB
            console.info("Searching Song: " + song.toSearchString());

            await spotifyApi.searchTracks(song.toSearchString()).then(async function (response : Object) {
                // Dumb little thing to allow for untyped Object
                let responseString = JSON.stringify(response);
                let responseObject = JSON.parse(responseString);
                if(responseObject.statusCode != 200) {
                    console.error("Status Code: " + responseObject.statusCode);
                    throw new Error(responseObject);
                }
                console.info("Spotify Data: " + JSON.stringify(responseObject.body));
                let data = responseObject.body;
                if (data.tracks.items.length > 0) {
                    var index = 0;
                    if (data.tracks.items.length > 1) {
                        let track0 = data.tracks.items[0];
                        let track1 = data.tracks.items[1];
                        if (!track0.explicit && track1.explicit &&
                            track0.name === track1.name &&
                            JSON.stringify(track0.artists) === JSON.stringify(track1.artists)) {
                                index = 1;
                        }
                    }
                    console.info("Attempting to add song to playlist. Song URI: " + data.tracks.items[index].uri);
                    await spotifyApi.addTracksToPlaylist(Secrets.SPOTIFY_PLAYLIST_ID, [data.tracks.items[index].uri]).then(async function (response: any) {
                        console.info("Successfully added to Playlist");
                        await mapper.put(song);
                    },
                    function (reason: string | undefined) {
                        console.error("Spotify addTracksToPlaylist failed.");
                        console.error(reason);
                        throw new Error(reason);
                    });                        
                } else {
                    console.error("Spotify searchTracks no results.");
                    console.error(JSON.stringify(data));
                    throw new Error("Spotify searchTracks no results. Query: " + song.toSearchString());
                }
            },
            function (err: string | undefined) {
                console.error("Spotify searchTracks error.");
                console.error(err);
                throw new Error(err);
            })
        })
    } else {
        if (response?.channels?.altnation?.content?.artists && 
            response.channels.altnation.content.artists[0].name === "alt nation") {
            // No song
            console.info("Non song response");
        } else {
            console.warn("Non song or invalid response: " + resp.data.toString());
            throw new Error("Not a song or an invalid response.");
        }
    }
}