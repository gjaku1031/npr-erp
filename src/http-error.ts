/** HTTP 상태코드를 가진 에러 (NestJS의 BadRequestException 등 대체). 라우터가 status로 매핑. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}
