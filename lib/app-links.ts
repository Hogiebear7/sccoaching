// Links to the app's store listing.
//
// The Android application ID is the one in the mobile app's own config (sc-coaching-mobile/app.json, android.package), the same value
// the Google Play server code expects as GOOGLE_PLAY_PACKAGE_NAME. It is not a secret. This is a plain link to the public listing page: no
// in-app review API is used or implied, and the member chooses to follow it. Only an Android browser is offered the link, because the
// listing is for the Android app; the web app is also used on iOS and desktop, where a "rate us on Google Play" link would mislead.

export const PLAY_STORE_APP_ID = "com.sandcperformancecoaching.app";

/** The App Store id from App Store Connect (App Information > Apple ID). Not a secret. */
export const APP_STORE_APP_ID = "6808795468";

export function appStoreListingUrl(appId: string = APP_STORE_APP_ID): string {
  return `https://apps.apple.com/app/id${encodeURIComponent(appId)}`;
}

/** Whether each public listing is live, so the website links to it. Set at build time once each store has published the app. */
export function storeListingsLive(): { appStore: boolean; googlePlay: boolean } {
  return {
    appStore: process.env.NEXT_PUBLIC_APP_STORE_LISTING_LIVE === "true",
    googlePlay: process.env.NEXT_PUBLIC_PLAY_LISTING_LIVE === "true",
  };
}

export function playStoreListingUrl(appId: string = PLAY_STORE_APP_ID): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
}

/** True for an Android browser user agent. Windows Phone and iOS strings that mention Android-like words do not match. */
export function isAndroidUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && /\bAndroid\b/i.test(userAgent) && !/Windows Phone|iPhone|iPad|iPod/i.test(userAgent);
}
