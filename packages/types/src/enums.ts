export enum UserRole {
  CUSTOMER = 'customer',
  COURIER = 'courier',
  ADMIN = 'admin',
}

export const ROLE_TO_INT: Record<UserRole, number> = {
  [UserRole.CUSTOMER]: 1,
  [UserRole.COURIER]: 2,
  [UserRole.ADMIN]: 3,
};
export const INT_TO_ROLE: Record<number, UserRole> = {
  1: UserRole.CUSTOMER,
  2: UserRole.COURIER,
  3: UserRole.ADMIN,
};

export enum OrderStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  DISPATCH_FAILED = 'dispatch_failed',
}

export enum DeliveryPriority {
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}
