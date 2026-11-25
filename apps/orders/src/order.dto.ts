import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { DeliveryPriority, OrderStatus } from '@rcn/types';

export class CreateOrderDto {
  @IsNumber() @Min(-90) @Max(90)
  pickupLat: number;

  @IsNumber() @Min(-180) @Max(180)
  pickupLng: number;

  @IsNumber() @Min(-90) @Max(90)
  dropoffLat: number;

  @IsNumber() @Min(-180) @Max(180)
  dropoffLng: number;

  @IsOptional() @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority;
}

export class UpdateStatusDto {
  @IsIn([OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED])
  status: OrderStatus;
}

export class CancelOrderDto {
  @IsString() @MinLength(1)
  reason: string;
}
