import {
    attribute,
    hashKey,
    rangeKey,
    table
  } from "@aws/dynamodb-data-mapper-annotations";
import { type } from "os";

@table("rs-altnation-songs")
export class Song {
    @hashKey({ type: "String" })
    artist: string;
    @rangeKey({ type: "String" })
    title: string;
    @attribute({ type: "String" })
    album?: string;

    toSearchString(): string {
      return "artist:" + this.artist + " track:" + this.title + " album:" + this.album;
    }

}