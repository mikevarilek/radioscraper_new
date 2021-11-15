import { ScheduledHandler } from 'aws-lambda'
import { Curl, CurlCode } from 'node-libcurl'
import { mapper } from './ddb'
import { Song } from './model/song'
import SpotifyWebApi from "spotify-web-api-js";
import { Secrets } from './secrets'

export const handler: ScheduledHandler = async (event) => {
    const curl = new Curl();
    curl.setOpt(Curl.option.URL, "https://www.siriusxm.com/servlet/Satellite?d=&pagename=SXM%2FServices%2FMountainWrapper&desktop=yes&channels=altnation");
    
    curl.on("end", function (statusCode, data, headers) {
        console.info("Status code " + statusCode);
        let response = JSON.parse(data.toString());
        if (response?.channels?.altnation?.content?.type && 
            response.channels.altnation.content.type === "Song") {
            let song = new Song();
            song.artist = response.channels.altnation.content.artists[0];
            song.title = response.channels.altnation.content.title;
            song.album = response.channels.altnation.content.album.title;

            mapper.get(song).then((alreadyExists: Song) => {
                console.info("Song already in DDB: " + JSON.stringify(alreadyExists));
            }).catch(err => {
                // TODO: Lookout for errors other than doesn't exist
                console.info(err);
                // Retrieve and add to spotify before writing to DDB
                const spotifyApi = new SpotifyWebApi();
                spotifyApi.setAccessToken(Secrets.SPOTIFY_API_KEY);

                spotifyApi.searchTracks(song.toSearchString()).then(function (data) {
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
                        spotifyApi.addTracksToPlaylist(Secrets.SPOTIFY_PLAYLIST_ID, [data.tracks.items[index].uri]).then(function (response) {
                            console.info("Successfully added to Playlist");
                            mapper.put(song).then((persisted: Song) => {
                                console.info("Successfully written to DDB");
                            }).catch(err => {
                                console.error("Failed to write to DDB");
                                console.error(err);
                                throw new Error(err);
                            });
                        },
                        function (reason) {
                            console.error("Spotify addTracksToPlaylist failed.");
                            console.error(reason);
                            throw new Error(reason);
                        });                        
                    } else {
                        console.error("Spotify searchTracks no results.");
                        console.error(JSON.stringify(data));
                        throw new Error("Spotify searchTracks no results.");
                    }
                },
                function (err) {
                    console.error("Spotify searchTracks error.");
                    console.error(err);
                    throw new Error(err);
                })

                mapper.put(song).then()
            })
        } else {
            // TODO: update this when I know more about responses
            console.warn("Non song or invalid response: " + data.toString());
            throw new Error("Not a song or an invalid response.");
        }
    });

    curl.on("error", function (this: Curl, error: Error, errorCode: CurlCode, curlInstance: Curl) {
        console.error("Curl failed. CurlCode: " + errorCode.toString());
        console.error("Error: " + error.name);
        console.error("Error Message: " + error.message);
        throw error;
    });

    curl.perform();
}