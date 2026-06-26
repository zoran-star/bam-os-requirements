export type HeaderValue = string | string[] | undefined;

export type ParentApiRequest = {
  body?: unknown;
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, HeaderValue>;
  url?: string;
};

export type ParentApiResponse = {
  setHeader(name: string, value: string): ParentApiResponse;
  status(code: number): ParentApiResponse;
  json(body: unknown): ParentApiResponse;
};
