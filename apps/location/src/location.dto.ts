import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateLocationDto {
  @IsNumber() @Min(-90) @Max(90)
  latitude: number;

  @IsNumber() @Min(-180) @Max(180)
  longitude: number;
}

export class NearbyQueryDto {
  @IsNumber() @Min(-90) @Max(90)
  lat: number;

  @IsNumber() @Min(-180) @Max(180)
  lng: number;

  @IsOptional() @IsNumber() @Min(100) @Max(50000)
  radiusM?: number;

  @IsOptional() @IsNumber() @Min(1) @Max(50)
  limit?: number;
}
