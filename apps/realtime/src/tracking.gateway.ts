import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthGrpcClient } from './auth-grpc.client';
import { RoomManager } from './room.manager';
import { RedisService } from './redis.service';

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly auth: AuthGrpcClient,
    private readonly rooms: RoomManager,
    private readonly membership: RedisService,
  ) {}

  afterInit(server: Server) {
    server.use(async (socket: Socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) return next(new Error('Authentication required'));
        const user = await this.auth.validate(token);
        if (!user.valid) return next(new Error('Invalid token'));
        socket.data.userId = user.userId;
        socket.data.role = user.role;
        next();
      } catch {
        next(new Error('Authentication failure'));
      }
    });
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.rooms.add(client.id, client.data.userId, client.data.role);
    client.emit('connected', {
      userId: client.data.userId,
      role: client.data.role,
    });
  }

  handleDisconnect(client: Socket) {
    this.rooms.remove(client.id);
  }

  @SubscribeMessage('subscribe:order')
  async subscribeOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string },
  ) {
    if (!data?.orderId) throw new WsException('orderId is required');
    const allowed = await this.membership.canSubscribe(
      data.orderId,
      client.data.userId,
      client.data.role,
    );
    if (!allowed) throw new WsException('Not authorized for this order');
    client.join(`order:${data.orderId}`);
    return { event: 'subscribed', data: { orderId: data.orderId } };
  }

  emitToOrder(orderId: string, event: string, payload: unknown): void {
    this.server.to(`order:${orderId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    for (const socketId of this.rooms.socketsOf(userId)) {
      if (this.rooms.canEmit(socketId)) {
        this.server.to(socketId).emit(event, payload);
      }
    }
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const t = client.handshake.auth?.token;
    if (typeof t === 'string') return t;
    const q = client.handshake.query?.token;
    return typeof q === 'string' ? q : null;
  }
}
