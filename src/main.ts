import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import * as fs from 'fs';
import axios from 'axios';
import 'dotenv/config';

async function main() {
  //
  const app = await NestFactory.create(AppModule);

  //
  await app.listen(process.env.PORT ?? 5001);
  console.log(`velix engine bot is running on: ${await app.getUrl()}`);
}

main();
