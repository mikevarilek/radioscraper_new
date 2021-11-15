import * as lambda from '@aws-cdk/aws-lambda'
import {NodejsFunction} from '@aws-cdk/aws-lambda-nodejs'
import * as targets from '@aws-cdk/aws-events-targets'
import * as events from '@aws-cdk/aws-events'
import * as ddb from '@aws-cdk/aws-dynamodb'
import * as iam from '@aws-cdk/aws-iam';
import * as cdk from '@aws-cdk/core';
import * as path from 'path';

export class RadioscraperNewStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new ddb.Table(this, 'rs-altnation-songs', {
      partitionKey: { name: 'artist', type: ddb.AttributeType.STRING },
      sortKey: { name: 'title', type: ddb.AttributeType.STRING },
      tableName: 'rs-altnation-songs',
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
    });

    const scrapeFunction = new NodejsFunction(this, 'scrapeAltNation', {
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'handler',
      entry: path.join(__dirname, `/../lambda/src/index.ts`),
      functionName: "RadioscraperNew-scrapeAltNation",
    });

    const eventRule = new events.Rule(this, 'scheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(2)),
    });

    eventRule.addTarget(new targets.LambdaFunction(scrapeFunction));

    const readWriteSongsTablePolicy = new iam.PolicyStatement({
      actions: ['dynamodb:DescribeTable',
                'dynamodb:Query',
                'dynamodb:Scan',
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem'],
      resources: ['arn:aws:dynamodb:*:*:table/rs-altnation-songs']
    })

    scrapeFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'SongsTablePolicy', {
        statements: [readWriteSongsTablePolicy],
      }),
    );
    
  }
}
