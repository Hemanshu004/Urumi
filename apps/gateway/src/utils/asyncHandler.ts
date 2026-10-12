import { Request, Response, NextFunction, RequestHandler } from "express";

export function asyncHandler<
  Req extends Request = any,
  Res extends Response = any
>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
