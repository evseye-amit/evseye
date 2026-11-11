import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from '../../../src/common/filters/http-exception.filter.js';
describe('readiness database guard HTTP responses',()=>{
 it.each([
  ['PREPARATION_QC_REQUIRED: Scooter requires current preparation and QC approval.','PREPARATION_QC_REQUIRED'],
  ['FLEET_ALLOCATION_BLOCKED: Allocation is administratively disabled.','FLEET_ALLOCATION_BLOCKED'],
 ])('returns a useful conflict for PostgreSQL guard %s',(message,code)=>{
  const response={header:vi.fn(),status:vi.fn(),send:vi.fn()};response.header.mockReturnValue(response);response.status.mockReturnValue(response);
  new HttpExceptionFilter().catch(new Prisma.PrismaClientUnknownRequestError(message,{clientVersion:'6.19.0'}),{switchToHttp:()=>({getResponse:()=>response,getRequest:()=>({headers:{},id:'test-request',method:'POST',url:'/api/v1/mobile-deployments/test/accept-pdi'})})} as never);
  expect(response.status).toHaveBeenCalledWith(409);
  expect(response.send).toHaveBeenCalledWith(expect.objectContaining({error:expect.objectContaining({code,message:expect.any(String)})}));
 });
});
