/**
 * Guides you through the Spotify Authorization Code flow, then writes the new
 * refresh token directly into DynamoDB so the Lambda can pick it up immediately.
 *
 * Usage:  npm run reauthorize-spotify
 *
 * Requirements:
 *   - AWS credentials configured locally (AWS CLI / environment variables)
 *   - https://google.com/ registered as a redirect URI in your Spotify app
 */
import * as readline from 'readline';
import { URL } from 'url';
import { execSync } from 'child_process';
import { Secrets } from '../lambda/src/secrets';
import { Song } from '../lambda/src/model/song';
import { mapper } from '../lambda/src/ddb';

const SpotifyWebApi = require('spotify-web-api-node');

const REDIRECT_URI = 'https://google.com/';
const SCOPES = ['playlist-modify-private', 'playlist-modify-public'];

const spotifyApi = new SpotifyWebApi({
    clientId: Secrets.SPOTIFY_CLIENT_ID,
    clientSecret: Secrets.SPOTIFY_API_KEY,
    redirectUri: REDIRECT_URI,
});

const authUrl = spotifyApi.createAuthorizeURL(SCOPES, 'radioscraper-reauth');

function tryOpenBrowser(url: string): void {
    try {
        if (process.platform === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        }
    } catch {
        // Browser open failed — user will copy the URL manually
    }
}

function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => {
        rl.close();
        resolve(answer.trim());
    }));
}

async function main() {
    console.log('\n=== Spotify Re-Authorization ===\n');
    console.log('Step 1 — Opening browser to Spotify authorization page...');
    console.log('         If it does not open, copy this URL manually:\n');
    console.log(`  ${authUrl}\n`);

    tryOpenBrowser(authUrl);

    console.log('Step 2 — Approve access in Spotify.');
    console.log('         You will be redirected to google.com.');
    console.log('         The URL in your browser will look like:');
    console.log('         https://google.com/?code=AQD...&state=radioscraper-reauth\n');

    const pasted = await prompt('Step 3 — Paste the full URL from your browser here:\n> ');

    let code: string | null = null;
    try {
        const parsed = new URL(pasted);
        code = parsed.searchParams.get('code');
    } catch {
        console.error('\nCould not parse that as a URL. Make sure you copied the full address bar URL.');
        process.exit(1);
    }

    if (!code) {
        console.error('\nNo "code" parameter found in the URL. Did you paste the right URL?');
        process.exit(1);
    }

    console.log('\nExchanging authorization code for tokens...');

    const data = await spotifyApi.authorizationCodeGrant(code);
    const refreshToken: string = data.body['refresh_token'];
    const accessToken: string  = data.body['access_token'];

    if (!refreshToken) {
        console.error('Spotify did not return a refresh token. Make sure offline_access / Authorization Code flow is being used.');
        process.exit(1);
    }

    console.log('Tokens received.');
    console.log(`  Access token:  ${accessToken.substring(0, 20)}...`);
    console.log(`  Refresh token: ${refreshToken.substring(0, 20)}...`);

    console.log('\nWriting refresh token to DynamoDB (table: rs-altnation-songs)...');

    const tokenRecord = new Song();
    tokenRecord.artist    = 'refresh_token';
    tokenRecord.title     = 'refresh_token';
    tokenRecord.album     = refreshToken;
    tokenRecord.updatedAt = new Date().toISOString();

    await mapper.put(tokenRecord);

    console.log('Refresh token saved to DynamoDB.');
    console.log('\nDone! Your Lambda will use the new token on its next run.\n');

    console.log('If you use the clean-playlist script locally, also update');
    console.log('SPOTIFY_REFRESH_TOKEN in scripts/secrets.ts with:');
    console.log(`  ${refreshToken}\n`);
}

main().catch(err => {
    console.error('\nUnexpected error:', err);
    process.exit(1);
});
