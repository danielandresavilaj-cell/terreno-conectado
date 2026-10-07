import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000)
  const app = configureApp(await NestFactory.create(AppModule))
  await app.listen(port)
}

void bootstrap()