export type HeaderValue = string | string[] | undefined;

export type RuntimeApiRequest = {
  body?: unknown;
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, HeaderValue>;
  url?: string;
};

export type RuntimeApiResponse = {
  setHeader(name: string, value: string): RuntimeApiResponse;
  status(code: number): RuntimeApiResponse;
  json(body: unknown): RuntimeApiResponse;
  end(body?: unknown): RuntimeApiResponse;
};
