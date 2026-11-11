import { Module } from '@nestjs/common'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

/** Administración de la empresa: cuentas y faenas (TSK-ADM-001). */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
