import {
    attribute,
    hashKey,
    rangeKey,
    table
  } from "@aws/dynamodb-data-mapper-annotations";

  @table("rs-altnation-songs")
export class Song {
    @hashKey()
    artist?: string;
    @rangeKey()
    title?: string;
    @attribute()
    album?: string;

    toSearchString(): string {
      return "artist:" + this.artist + " track:" + this.title + " album:" + this.album;
    }

}