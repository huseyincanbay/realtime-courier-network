import { OrderStatus } from './enums';

export interface BaseEvent {
  version: number;
  timestamp: string;
  correlationId?: string;
}

export interface OrderCreatedEvent extends BaseEvent {
  type: 'order.created';
  orderId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  priority: string;
}

export interface OrderAssignedEvent extends BaseEvent {
  type: 'order.assigned';
  orderId: string;
  courierId: string;
  etaMinutes: number;
}

export interface OrderStatusUpdatedEvent extends BaseEvent {
  type: 'order.status.updated';
  orderId: string;
  previousStatus: OrderStatus;
  newStatus: OrderStatus;
  courierId?: string;
}

export interface OrderCancelledEvent extends BaseEvent {
  type: 'order.cancelled';
  orderId: string;
  courierId?: string;
  reason: string;
}

export interface CourierLocationUpdatedEvent extends BaseEvent {
  type: 'courier.location.updated';
  courierId: string;
  orderId?: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
}

export type DispatchEvent =
  | OrderCreatedEvent
  | OrderAssignedEvent
  | OrderStatusUpdatedEvent
  | OrderCancelledEvent
  | CourierLocationUpdatedEvent;
