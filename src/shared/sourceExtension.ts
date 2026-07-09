export type SourceExtensionKind = 'prod' | 'dev';

export interface SourceExtensionProfile {
  downloadPath: string;
  id: string;
  key: string;
  kind: SourceExtensionKind;
  name: string;
  packageFilename: string;
  packagePrefix: string;
}

export const PROD_SOURCE_EXTENSION_ID = 'ncgeehcdlbbdgojleaoefhhdinmdhcaf';
export const DEV_SOURCE_EXTENSION_ID = 'jglagfhfffmokhgmaijndppinlbolpee';

const PROD_SOURCE_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvqHAzC8s2K9edGvz9/UsG/c02eQu0OeYMWPxGBoSwEltPU+9lLSr5CkD9dgA2XeUw3TfpGGFIN2S83VWblwD6SWViJ9gxWbanN4c13QD3ZQkppptcDZuR1wS+sdZI+01dmBjuNI/4mx9NaXwCSaI9hTb+i0qBYeVxQTQX+D2k/urYg8PO7W/Q1lEAiW4rNi94vfhNVfBzIs095uuoDF4AvclwkD5tJz64pL6Vw7XW8ILoME7+PwvQQs6uqmhFr7uiHmJ549Aj5332f8N6KU7Z2DTdaXkoc03IgMMbiMxvUJ0oMldF3BZA6ZxpBL5WnTLCk8cAxtjUg1tluvO+793kwIDAQAB';

const DEV_SOURCE_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu6jmMYjd4Z+wb0CJY+9e9F/YGGaSi0dGHJu9sKEadyeDEplwJiCIknUcSenaT4rn6OhHOnKpqanFyM9eHvZmN7hjC3nUOIcueve2wvXlatHovSnR8Ww7kYqCEoh5kErmRUKTTolDrPCWvS13jEZaZGzPMH31Kittd8LLA1JgtN9w14JAXX+JJyS8WwlchPAbWmEiLdfDi5diwZz7UE8CEVDru1nu1GdWCNZxYzksT3xWnY4T/wxUUqhGblBkM+TVI0akzDFP8IK3X/q26/K21ov6dG81TJbkxfGTbF/BemU/sAdNhMvUMy0tCPnryNyvfeOKM+epgvEMVzrobrL94QIDAQAB';

const PROFILES: Record<SourceExtensionKind, SourceExtensionProfile> = {
  prod: {
    downloadPath: '/extension/shv-source-helper.zip',
    id: PROD_SOURCE_EXTENSION_ID,
    key: PROD_SOURCE_EXTENSION_KEY,
    kind: 'prod',
    name: 'shv Source Helper',
    packageFilename: 'shv-source-helper.zip',
    packagePrefix: 'shv-source-helper'
  },
  dev: {
    downloadPath: '/extension/shv-source-helper-dev.zip',
    id: DEV_SOURCE_EXTENSION_ID,
    key: DEV_SOURCE_EXTENSION_KEY,
    kind: 'dev',
    name: 'shv Source Helper Dev',
    packageFilename: 'shv-source-helper-dev.zip',
    packagePrefix: 'shv-source-helper-dev'
  }
};

export function sourceExtensionProfile(kind: SourceExtensionKind): SourceExtensionProfile {
  return PROFILES[kind];
}
