import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { LocationService } from './location.service';
import { UpdateLocationDto, NearbyQueryDto } from './location.dto';

@Controller('location')
export class LocationController {
  constructor(private readonly location: LocationService) {}

  @Post('update')
  @HttpCode(200)
  update(@Headers('x-user-id') courierId: string, @Body() dto: UpdateLocationDto) {
    return this.location.updateLocation(courierId, dto.latitude, dto.longitude);
  }

  @Get('courier/:id')
  getCourier(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string,
    @Headers('x-user-role') role: string,
  ) {
    return this.location.getCourierLocation(id, userId, role);
  }

  @Get('nearby')
  nearby(@Query() dto: NearbyQueryDto) {
    return this.location.getNearby(dto.lat, dto.lng, dto.radiusM, dto.limit);
  }
}
