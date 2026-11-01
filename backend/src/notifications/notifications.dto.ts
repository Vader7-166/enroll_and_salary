import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsUUID } from "class-validator";

export class NotificationQueryDto {
  @IsOptional() @IsIn(["true", "false"]) unreadOnly?: string;
  @IsOptional() @IsISO8601() before?: string;
}

export class MarkReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID("all", { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}
