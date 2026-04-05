export type HttpProviderKey = `/${string}`;

export type NonHttpProviderKey<TKey extends string = string> = TKey extends HttpProviderKey
  ? never
  : TKey;
