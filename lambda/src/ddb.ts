import { DataMapper } from "@aws/dynamodb-data-mapper";
import { DynamoDB } from "aws-sdk";

const dynamoDBOptions: DynamoDB.ClientConfiguration = {
  region: "us-east-1",
};

const client = new DynamoDB(dynamoDBOptions);
export const mapper = new DataMapper({ client });