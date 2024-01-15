# Welcome to your CDK TypeScript project!

This is a simple AWS CDK and Node project for grabbing the currently playing song from a SiriusXM station. It stores the song in AWS DDB and if the song is new it will attempt to find it in Spotify and add it to a playlist.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
