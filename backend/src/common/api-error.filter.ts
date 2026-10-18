import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      // Preserve the existing public health contract, including database down/503.
      if (typeof body === 'object' && body !== null && 'service' in body && body.service === 'hrtp-api') {
        response.status(error.getStatus()).json(body);
        return;
      }
      const details = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
      const value = details.message ?? body;
      const message = Array.isArray(value) ? value.join('; ') : typeof value === 'string' ? value : 'Yêu cầu không hợp lệ.';
      const status = error.getStatus();
      const codes: Record<number, string> = {400:'VALIDATION_ERROR',401:'UNAUTHENTICATED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',429:'RATE_LIMITED'};
      response.status(status).json({ code: typeof details.code === 'string' ? details.code : codes[status] ?? 'REQUEST_FAILED', message });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const employeeCode = error.meta?.modelName === "Employee";
      response.status(409).json({ code: employeeCode ? "EMPLOYEE_CODE_EXISTS" : "CONFLICT", message: employeeCode ? "Mã nhân viên đã tồn tại." : "Mã hoặc bản ghi đã tồn tại. Kiểm tra dữ liệu và tải lại." });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      response.status(409).json({ code: "CONFLICT", message: "Dữ liệu vừa thay đổi trong giao dịch khác. Tải lại trước khi thực hiện." });
      return;
    }
    Logger.error(error instanceof Error ? error.name : 'Unknown error', 'ApiErrorFilter');
    response.status(500).json({ code: 'INTERNAL_ERROR', message: 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
  }
}
