// App.js — WizMarketing WebView Bridge (iOS/Android 공용)
// - push + auth: Firebase(Google) / Kakao(iOS 라이브러리·Android 네이티브) + SafeArea + Channel Share + Image Download→Gallery

import React, { useCallback, useEffect, useRef, useState } from 'react';
import firebase from '@react-native-firebase/app';
import {
  BackHandler, StyleSheet, Platform,
  Linking, LogBox, Animated, Easing, StatusBar,
  PermissionsAndroid, NativeModules,
} from 'react-native';
import { WebView } from 'react-native-webview';
try { firebase.app(); } catch { try { firebase.initializeApp(); } catch { } }
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import Share from 'react-native-share';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import SplashScreenRN from './SplashScreenRN';

// ★ v14 표준: useIAP 훅 기반
import { getAvailablePurchases, useIAP } from 'react-native-iap';

import { appleAuth } from '@invertase/react-native-apple-authentication';
import SHA256 from 'crypto-js/sha256';
import { randomBytes } from 'react-native-randombytes';

// iOS용 카카오 로그인 라이브러리(안드로이드는 기존 네이티브 모듈 사용)
import {
  login as kakaoLoginIOS,
  getProfile as kakaoGetProfileIOS,
  loginWithKakaoAccount as kakaoLoginWithAccountIOS,
  loginWithKakaoTalk as kakaoLoginWithTalkIOS,
} from '@react-native-seoul/kakao-login';

import AsyncStorage from '@react-native-async-storage/async-storage';



const IG_SCHEME = 'instagram://';
const IG_STORIES_SCHEME = 'instagram-stories://share';
const IG_IOS_STORE = 'itms-apps://itunes.apple.com/app/id389801252';
const IG_ANDROID_STORE = 'market://details?id=com.instagram.android';
const IG_ANDROID_HTTP = 'https://play.google.com/store/apps/details?id=com.instagram.android';

async function ensureInstagramInstalled({ stories = false } = {}) {
  const scheme = stories ? IG_STORIES_SCHEME : IG_SCHEME;
  try {
    const ok = await Linking.canOpenURL(scheme);
    if (ok) return true;
  } catch { }
  // not installed → open store
  try {
    await Linking.openURL(Platform.OS === 'ios' ? IG_IOS_STORE : IG_ANDROID_STORE);
  } catch {
    if (Platform.OS === 'android') await Linking.openURL(IG_ANDROID_HTTP);
  }
  return false;
}

// ─────────── 설치 ID (installation_id) 유틸 ───────────
function makeRandomId() {
  return 'wiz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
async function getOrCreateInstallId() {
  try {
    const key = 'install_id';
    let id = await AsyncStorage.getItem(key);
    if (!id) {
      id = makeRandomId();
      await AsyncStorage.setItem(key, id);
    }
    return id;
  } catch {
    return makeRandomId();
  }
}

const randomNonce = (n = 32) => {
  try {
    return (randomBytes(n)).toString('hex'); // RN Buffer → hex
  } catch {
    const chars = 'abcdef0123456789';
    let s = '';
    for (let i = 0; i < n * 2; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
};

// ────────────────────────────────────────────────────────────────────────────

const { KakaoLoginModule } = NativeModules; // Android 전용 커스텀 모듈 유지
const kakaoAndroid = (Platform.OS === 'android' && KakaoLoginModule && typeof KakaoLoginModule === 'object') ? KakaoLoginModule : null;

const APP_VERSION = '1.0.0';
const BOOT_TIMEOUT_MS = 8000;
const MIN_SPLASH_MS = 1200;
const TAG = '[WizApp]';
const NAVER_AUTH_URL = 'https://nid.naver.com/oauth2.0/authorize';
const NAVER_CLIENT_ID = 'YSd2iMy0gj8Da9MZ4Unf';

// ===== IAP 로그 헬퍼 =====
const IAP_TAG = '[IAP][ios]';
const logIap = (...a) => { try { console.log(IAP_TAG, ...a); } catch { } };

// Google Sign-In
GoogleSignin.configure({
  webClientId: '266866879152-kfquq1i6r89tbqeramjjuaa2csmoegej.apps.googleusercontent.com',
  offlineAccess: true,
});

// Social map
const SOCIAL = Share.Social;
const SOCIAL_MAP = {
  INSTAGRAM: SOCIAL.INSTAGRAM,
  INSTAGRAM_STORIES: SOCIAL.INSTAGRAM_STORIES,
  FACEBOOK: SOCIAL.FACEBOOK,
  TWITTER: SOCIAL.TWITTER,
  SMS: SOCIAL.SMS,
  KAKAO: 'KAKAO',
  NAVER: 'NAVER',
  SYSTEM: 'SYSTEM',
};

// ─────────── utils ───────────
const replacer = (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : (typeof v === 'bigint' ? String(v) : v));
const safeStringify = (v, max = 100000) => { try { const s = JSON.stringify(v, replacer, 2); return s.length > max ? s.slice(0, max) + '…(trunc)' : s; } catch (e) { return `<non-serializable: ${String(e?.message || e)}>`; } };
const logChunked = (tag, obj, size = 3000) => {
  try {
    const s = safeStringify(obj);
    for (let i = 0; i < s.length; i += size) {
      console.log(`${tag}[${1 + Math.floor(i / size)}] ${s.slice(i, i + size)}`);
    }
  } catch (e) {
    console.log(`${tag}[logChunked][ERR]`, e?.message || e);
  }
};

  function buildFinalText({ caption, hashtags = [], couponEnabled = false, link } = {}) {
    const tags = Array.isArray(hashtags) ? hashtags.join(' ') : (hashtags || '');
    return `${caption || ''}${tags ? `\n\n${tags}` : ''}${couponEnabled ? `\n\n✅ 민생회복소비쿠폰` : ''}${link ? `\n${link}` : ''}`.trim();
  }

  function downloadTo(fromUrl, toFile) { return RNFS.downloadFile({ fromUrl, toFile }).promise; }
  function guessExt(u = '') { u = u.toLowerCase(); if (u.includes('.png')) return 'png'; if (u.includes('.webp')) return 'webp'; if (u.includes('.gif')) return 'gif'; return 'jpg'; }
  function extToMime(e) { return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg'; }

  async function ensureMediaPermissions() {
    if (Platform.OS !== 'android') return;
    if (Platform.Version >= 33) {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
      if (res !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('READ_MEDIA_IMAGES denied');
    } else {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
      if (res !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('WRITE_EXTERNAL_STORAGE denied');
    }
  }

  async function downloadAndSaveToGallery(url, filename = 'image.jpg') {
    if (!url) throw new Error('no_url');
    await ensureMediaPermissions();
    const ext = (url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
    const name = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
    const dest = `${RNFS.CachesDirectoryPath}/${Date.now()}_${name}`;
    const { statusCode } = await RNFS.downloadFile({ fromUrl: url, toFile: dest }).promise;
    if (!(statusCode >= 200 && statusCode < 300)) throw new Error(`download failed: ${statusCode}`);
    await CameraRoll.save(dest, { type: 'photo' });
    RNFS.unlink(dest).catch(() => { });
  }

  function safeStr(x) { if (typeof x === 'string') return x; if (x == null) return ''; try { return String(x); } catch { return ''; } }
  function stripImageUrlsFromText(text) {
    const s = safeStr(text);
    const out = s.replace(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi, '');
    return out.replace(/[ \t]{2,}/g, ' ').trim();
  }

  async function ensureLocalPng(src) {
    if (!src) throw new Error('no-source');
    if (src.startsWith('file://') || src.startsWith('content://') || src.startsWith('data:')) {
      return { uri: src, cleanup: async () => { } };
    }
    const dlPath = `${RNFS.CachesDirectoryPath}/ig_story_${Date.now()}.png`;
    const r = await RNFS.downloadFile({ fromUrl: src, toFile: dlPath }).promise;
    if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`story-download-fail-${r?.statusCode || 'unknown'}`);
    const st = await RNFS.stat(dlPath);
    if (!st.isFile() || Number(st.size) <= 0) throw new Error('story-downloaded-file-empty');
    return { uri: `file://${dlPath}`, cleanup: async () => { try { await RNFS.unlink(dlPath); } catch { } } };
  }

  async function ensureLocalFile(src, preferExt = 'jpg') {
    if (!src) throw new Error('no-source');
    if (src.startsWith('file://') || src.startsWith('content://') || src.startsWith('data:')) {
      return { uri: src, cleanup: async () => { } };
    }
    const extRaw = (guessExt(src) || preferExt).toLowerCase();
    const tmpPath = `${RNFS.CachesDirectoryPath}/ig_${Date.now()}.${extRaw}`;
    const r = await RNFS.downloadFile({ fromUrl: src, toFile: tmpPath, headers: { Accept: 'image/jpeg,image/*;q=0.8' } }).promise;
    if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`ig-download-fail-${r?.statusCode || 'unknown'}`);
    const st = await RNFS.stat(tmpPath);
    if (!st.isFile() || Number(st.size) <= 0) throw new Error('ig-downloaded-file-empty');
    const out = tmpPath.startsWith('file://') ? tmpPath : `file://${tmpPath}`;
    return { uri: out, cleanup: async () => { try { await RNFS.unlink(tmpPath); } catch { } } };
  }

  async function saveDataUrlToGallery(dataUrl, filename) {
    const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('invalid_dataurl');
    const base64 = match[2];
    const tmpPath = `${RNFS.CachesDirectoryPath}/${filename}`;
    await RNFS.writeFile(tmpPath, base64, 'base64');
    await CameraRoll.save(tmpPath, { type: 'photo' });
  }

  // ─────────── 공유(카카오/인스타 등) ───────────
  // async function handleShareToChannel(payload, sendToWeb) {
  //   const key = (payload?.social || '').toUpperCase();
  //   const data = payload?.data || {};
  //   const social = SOCIAL_MAP[key] ?? SOCIAL_MAP.SYSTEM;

  //   const text = buildFinalText(data);
  //   let file = data.imageUrl || data.url || data.image;

  //   try {
  //     const needClipboard = [Share.Social.INSTAGRAM, Share.Social.INSTAGRAM_STORIES, Share.Social.FACEBOOK].includes(social);
  //     if (needClipboard && text) { Clipboard.setString(text); sendToWeb('TOAST', { message: '캡션이 복사되었어요. 업로드 화면에서 붙여넣기 하세요.' }); }

  //     const ext = guessExt(file) || 'jpg';
  //     const mime = extToMime(ext) || 'image/*';

  //     if (key === 'KAKAO') {
  //       if (!file) throw new Error('no_image_for_kakao');
  //       const kExt = guessExt(file) || 'jpg';
  //       const dlPath = `${RNFS.CachesDirectoryPath}/share_${Date.now()}.${kExt}`;
  //       const r = await RNFS.downloadFile({ fromUrl: file, toFile: dlPath }).promise;
  //       if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`download ${r?.statusCode || 'fail'}`);
  //       const st = await RNFS.stat(dlPath);
  //       if (!st.isFile() || Number(st.size) <= 0) throw new Error('downloaded-file-empty');

  //       const fileUrl = `file://${dlPath}`;
  //       const kMime = extToMime(kExt) || 'image/*';

  //       await Share.open({ title: '카카오톡으로 공유', url: fileUrl, type: kMime, filename: `share.${kExt}`, message: stripImageUrlsFromText(text), failOnCancel: false });
  //       try { await RNFS.unlink(dlPath); } catch { }
  //       sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
  //       return;
  //     }

  //     if (social === Share.Social.INSTAGRAM_STORIES) {
  //       const { uri, cleanup } = await ensureLocalPng(file);
  //       try {
  //         await Share.shareSingle({
  //           social: Share.Social.INSTAGRAM_STORIES,
  //           backgroundImage: uri,
  //           attributionURL: data.link,
  //           backgroundTopColor: '#000000',
  //           backgroundBottomColor: '#000000',
  //           type: 'image/png',
  //           filename: 'share.png',
  //           failOnCancel: false,
  //         });
  //       } catch {
  //         await Share.open({ url: uri, type: 'image/png', filename: 'share.png', failOnCancel: false });
  //       } finally { await cleanup(); }
  //       sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
  //       return;
  //     }

  //     if (typeof social === 'string' && !['SYSTEM', 'KAKAO', 'NAVER'].includes(social)) {
  //       await Share.shareSingle({ social, url: file, message: needClipboard ? undefined : text, type: mime, filename: `share.${ext}`, failOnCancel: false });
  //       sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
  //       return;
  //     }

  //     await Share.open({ url: file, message: text, title: '공유', type: mime, filename: `share.${ext}`, failOnCancel: false });
  //     sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
  //   } catch (err) {
  //     sendToWeb('SHARE_RESULT', { success: false, platform: key, error_code: 'share_failed', message: String(err?.message || err) });
  //   }
  // }


async function handleShareToChannel(payload, sendToWeb) {
  const key = (payload?.social || '').toUpperCase();
  const data = payload?.data || {};
  const social = SOCIAL_MAP[key] ?? SOCIAL_MAP.SYSTEM;

  const text = buildFinalText(data);
  let file = data.imageUrl || data.url || data.image;

  // iOS 판별
  const isIOS = Platform.OS === 'ios';

  try {
    // 1) (인스타/페북 등) 정책상 캡션 프리필 불가 → 클립보드 안내
    const needClipboard = [
      Share.Social.INSTAGRAM,
      Share.Social.INSTAGRAM_STORIES,
      Share.Social.FACEBOOK,
    ].includes(social);
    if (needClipboard && text) {
      Clipboard.setString(text);
      sendToWeb?.('TOAST', { message: '캡션이 복사되었어요. 업로드 화면에서 붙여넣기 하세요.' });
    }

    // 2) Kakao 전용 처리 (파일 로컬화 + 메시지에서 이미지 URL 제거)
    if (key === 'KAKAO') {
      if (!file) throw new Error('no_image_for_kakao');
      const kExt = guessExt(file) || 'jpg';
      const dlPath = `${RNFS.CachesDirectoryPath}/share_${Date.now()}.${kExt}`;
      const r = await RNFS.downloadFile({ fromUrl: file, toFile: dlPath }).promise;
      if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`download ${r?.statusCode || 'fail'}`);

      const st = await RNFS.stat(dlPath);
      if (!st.isFile() || Number(st.size) <= 0) throw new Error('downloaded-file-empty');

      const fileUrl = `file://${dlPath}`;
      const kMime = extToMime(kExt) || 'image/*';

      await Share.open({
        title: '카카오톡으로 공유',
        url: fileUrl,
        type: kMime,
        filename: `share.${kExt}`,
        message: stripImageUrlsFromText(text),
        failOnCancel: false,
      });

      try { await RNFS.unlink(dlPath); } catch { }

      sendToWeb?.('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    // 3) Instagram Stories (iOS/Android 공통) — PNG 선호 + 폴백
    if (social === Share.Social.INSTAGRAM_STORIES) {


      const installed = await ensureInstagramInstalled({ stories: true });
      if (!installed) return; // 스토어로 보냈으니 종료

      if (!file) throw new Error('no_image_source');
      const { uri, cleanup } = await ensureLocalPng(file);
      try {
        try {
          await Share.shareSingle({
            social: Share.Social.INSTAGRAM_STORIES,
            backgroundImage: uri,
            attributionURL: data.link, // 무시될 수 있음
            backgroundTopColor: '#000000',
            backgroundBottomColor: '#000000',
            type: 'image/png',
            filename: 'share.png',
            failOnCancel: false,
          });
        } catch {
          await Share.open({
            url: uri,
            type: 'image/png',
            filename: 'share.png',
            failOnCancel: false,
          });
        }
        sendToWeb?.('SHARE_RESULT', { success: true, platform: key, post_id: null });
      } finally {
        try { await cleanup(); } catch { }
      }
      return;
    }

    // 4) Instagram Feed — iOS에서는 시스템 공유 시트 권장(직행 제한/불안정)
    if (social === Share.Social.INSTAGRAM && isIOS) {

      const installed = await ensureInstagramInstalled({ stories: true });
      if (!installed) return; // 스토어로 보냈으니 종료
      
      if (!file) throw new Error('no_image_source');
      const ext = guessExt(file) || 'jpg';
      const mime = extToMime(ext) || 'image/jpeg';
      const { uri, cleanup } = await ensureLocalFile(file, ext); // 로컬 파일 보장
      try {
        await Share.open({
          url: uri,
          type: mime,
          filename: `share.${ext}`,
          // iOS Instagram은 메시지 프리필 불가 → 클립보드 안내만 유지
          failOnCancel: false,
        });
        sendToWeb?.('SHARE_RESULT', { success: true, platform: key, method: 'system_sheet', post_id: null });
      } finally {
        try { await cleanup(); } catch { }
      }
      return;
    }

    // 5) 그 외 특정 소셜들(페북 등) — shareSingle 사용
    //    (단, iOS에서 메시지 프리필 불가한 플랫폼은 Clipboard만)
    if (typeof social === 'string' && !['SYSTEM', 'KAKAO', 'NAVER'].includes(social)) {
      if (!file) throw new Error('no_image_source');
      const ext = guessExt(file) || 'jpg';
      const mime = extToMime(ext) || 'image/*';

      // 가능한 한 로컬 파일을 보장해서 실패 확률을 낮춤
      const { uri, cleanup } = await ensureLocalFile(file, ext);
      try {
        await Share.shareSingle({
          social,
          url: uri,
          type: mime,
          filename: `share.${ext}`,
          message: needClipboard ? undefined : text,
          failOnCancel: false,
        });
        sendToWeb?.('SHARE_RESULT', { success: true, platform: key, post_id: null });
      } finally {
        try { await cleanup(); } catch { }
      }
      return;
    }

    // 6) 시스템 공유 (기본 폴백) — iOS/Android 공통
    {
      if (!file) throw new Error('no_image_source');
      const ext = guessExt(file) || 'jpg';
      const mime = extToMime(ext) || 'image/*';

      // 시스템 공유도 로컬 파일이면 성공률이 높음
      const { uri, cleanup } = await ensureLocalFile(file, ext);
      try {
        await Share.open({
          url: uri,
          message: text,
          title: '공유',
          type: mime,
          filename: `share.${ext}`,
          failOnCancel: false,
        });
        sendToWeb?.('SHARE_RESULT', { success: true, platform: key, post_id: null });
      } finally {
        try { await cleanup(); } catch { }
      }
    }
  } catch (err) {
    sendToWeb?.('SHARE_RESULT', {
      success: false,
      platform: key,
      error_code: 'share_failed',
      message: String(err?.message || err),
    });
  }
}

  // ─────────── IAP SKU (iOS) ───────────
  const IOS_INAPP_BASIC = 'wm_basic_n'; // 단건(Consumable)
  const IOS_SUBS_SKUS = ['wm_standard_m', 'wm_premium_m', 'wm_concierge_m'];

  // ───────── Manage Subscription (iOS App Store 구독 화면) ─────────
  async function openManageSubscriptionIOS() {
    const deep = 'itms-apps://apps.apple.com/account/subscriptions'; // 스토어 앱 강제
    try {
      const ok = await Linking.canOpenURL(deep);
      return Linking.openURL(ok ? deep : 'https://apps.apple.com/account/subscriptions'); // 폴백
    } catch (e) {
      console.log('[openManageSubscriptionIOS][ERR]', e?.message || e);
    }
  }

  // ─────────── App ───────────
  const App = () => {
    // 대기 중인 resolve 콜백들을 담아둘 큐
    const iapWaitersRef = useRef([]); // Array<(res: any) => void>
    const webViewRef = useRef(null);

    // === IAP 전용 송신기 (웹 준비 전 큐잉 → 준비되면 flush) ===
    const webIapReadyRef = useRef(false);
    const webIapQueueRef = useRef([]); // string[]
    const sendIapToWeb = useCallback((type, payload = {}) => {
      try {
        const msg = JSON.stringify({ type, payload });
        if (!webIapReadyRef.current || !webViewRef.current) {
          webIapQueueRef.current.push(msg);
          console.log('[WEB_IAP][queue]', type, 'queued. size=', webIapQueueRef.current.length);
          return;
        }
        console.log('[WEB_IAP][post]', type);
        webViewRef.current.postMessage(msg);
      } catch (e) {
        console.log('❌ sendIapToWeb error:', e);
      }
    }, []);

    const [splashVisible, setSplashVisible] = useState(true);
    const splashStartRef = useRef(0);
    const splashFade = useRef(new Animated.Value(1)).current;

    const bootTORef = useRef(null);
    const [token, setToken] = useState('');
    const lastPushTokenRef = useRef('');
    const lastNavStateRef = useRef({});

    const isUserCancel = (e) => {
      const msg = String(e?.message || e || '').toLowerCase();
      const code = String(e?.code || '').toLowerCase();
      return (
        code.includes('cancel') ||
        code === 'e_cancelled_operation' ||
        code === 'canceled' || code === 'cancelled' ||
        msg.includes('cancel') || msg.includes('취소')
      );
    };

    const [installId, setInstallId] = useState(null);

    // === IAP Hook (v14) ===
    const {
      connected,
      products,
      subscriptions,
      latestPurchase,
      error: iapError,
      isLoading,
      fetchProducts,
      requestPurchase,
      restorePurchases,
      finishTransaction,
    } = useIAP();


    // 2) (여기!) 헬퍼 배치 — onMessageFromWeb보다 위
    const pickKey = (x) => Number(x?.expirationDateIOS || x?.transactionDate || 0);

    async function probeLatestBySnapshot(targetSku) {
      try {
        const arr = await getAvailablePurchases();
        const list = Array.isArray(arr) ? arr.filter(x => x?.productId) : [];
        const best = list.sort((a, b) => pickKey(b) - pickKey(a))[0] || null;
        if (!best) return null;
        if (targetSku && best.productId !== targetSku) return null;
        return {
          productId: best.productId,
          transactionId: best.transactionId || best.originalTransactionIdentifierIOS || null,
          transactionDate: best.transactionDate || null,
          isConsumable: best.productId === IOS_INAPP_BASIC,
        };
      } catch {
        return null;
      }
    }

    function waitIapResult(timeoutMs = 120000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          console.log('[IAP][wait] timeout', timeoutMs, 'ms');
          resolve({
            success: false,
            platform: Platform.OS,
            error_code: 'timeout',
            message: 'iap_result_timeout',
          });
        }, timeoutMs);

        iapWaitersRef.current.push((res) => {
          clearTimeout(timer);
          resolve(res);
        });
      });
    }

    useEffect(() => {
      let mounted = true;
      (async () => {
        const id = await getOrCreateInstallId();
        if (mounted) setInstallId(id);
      })();
      return () => { mounted = false; };
    }, []);

    /**
     * 결과를 모든 대기자에게 전달해 해제해준다.
     * @param {object} result - { success:boolean, platform:'ios'|'android', ... }
     */
    const notifyIapResult = useCallback((result) => {
      try {
        console.log('[IAP][notify]', result?.success ? 'success' : 'fail', result);
        const waiters = iapWaitersRef.current.splice(0, iapWaitersRef.current.length);
        waiters.forEach(fn => { try { fn(result); } catch { } });
      } catch (e) {
        console.log('[IAP][notify][ERR]', e?.message || e);
      }
    }, []);

    useEffect(() => { LogBox.ignoreAllLogs(true); }, []);

    const sendToWeb = useCallback((type, payload = {}) => {
      try {
        const msg = JSON.stringify({ type, payload });
        webViewRef.current?.postMessage(msg);
      } catch (e) { console.log('❌ postMessage error:', e); }
    }, []);

    // ===== IAP 스냅샷 로그 =====
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      console.log('[IAP][snapshot] connected=', connected, 'isLoading=', isLoading);
      if (latestPurchase) {
        try { console.log('[IAP][snapshot.latest]', JSON.stringify({ productId: latestPurchase.productId, transactionId: latestPurchase.transactionId, transactionDate: latestPurchase.transactionDate }, null, 2)); }
        catch { console.log('[IAP][snapshot.latest]<unserializable>'); }
      } else {
        console.log('[IAP][snapshot.latest]<null>');
      }
      if (iapError) {
        console.log('[IAP][snapshot.error]', iapError?.code, String(iapError?.message || iapError));
      } else {
        console.log('[IAP][snapshot.error]<null>');
      }
    }, [connected, isLoading, latestPurchase, iapError]);

    // ─────────── IAP 진행 락(중복 실행 방지) + 진행 정보 ───────────
    const iapBusyRef = useRef(false);
    const lastIapTsRef = useRef(0);
    const iapKindRef = useRef(null); // 'inapp' | 'subs'
    const iapSkuRef = useRef(null);

    const beginIap = useCallback((tag, extra = {}) => {
      return true;
    }, []);

    const endIap = useCallback(() => {
    }, []);

    const hideSplashRespectingMin = useCallback(() => {
      const elapsed = Date.now() - (splashStartRef.current || Date.now());
      const wait = Math.max(MIN_SPLASH_MS - elapsed, 0);
      setTimeout(() => {
        Animated.timing(splashFade, { toValue: 0, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true })
          .start(() => setSplashVisible(false));
      }, wait);
    }, [splashFade]);

    const showSplashOnce = useCallback(() => {
      if (!splashVisible) { setSplashVisible(true); splashFade.setValue(1); splashStartRef.current = Date.now(); }
      else if (!splashStartRef.current) { splashStartRef.current = Date.now(); }
    }, [splashFade, splashVisible]);

    // HW Back (모든 Alert 제거 → 웹으로만 신호 전달)
    useEffect(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const nav = lastNavStateRef.current || {};
        const isRoot = nav.isRoot === true;
        const webCanHandle = !isRoot || nav.hasBlockingUI === true || nav.needsConfirm === true || nav.canGoBackInWeb === true;

        if (webCanHandle) { sendToWeb('BACK_REQUEST', { nav, at: Date.now() }); return true; }
        sendToWeb('APP_EXIT_REQUEST', { at: Date.now() });
        return true;
      });
      return () => sub.remove();
    }, [sendToWeb]);

    const handleWebReady = useCallback(() => {
      console.log('[WEB] WEB_READY received → ACK + splash hide');
      if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
      sendToWeb('WEB_READY_ACK', { at: Date.now(), install_id: installId ?? 'unknown' });
      hideSplashRespectingMin();
    }, [hideSplashRespectingMin, sendToWeb, installId]);

    const handleWebError = useCallback((payload) => {
      console.log('[WEB] WEB_ERROR', payload);
      if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
      sendToWeb('WEB_ERROR_ACK', { ...(payload || {}), at: Date.now() });
      sendToWeb('OFFLINE_FALLBACK', { reason: payload?.reason || 'js_error', at: Date.now() });
    }, [sendToWeb]);

    const ensureNotificationPermission = useCallback(async () => {
      try { const settings = await notifee.requestPermission(); return !!settings?.authorizationStatus; }
      catch { return false; }
    }, []);

    const replyPermissionStatus = useCallback(({ pushGranted }) => {
      sendToWeb('PERMISSION_STATUS', { push: { granted: !!pushGranted, blocked: false, install_id: installId ?? 'unknown' }, token });
    }, [sendToWeb, token, installId]);

    const sha256 = (s) => SHA256(s).toString();
    const rawNonce = randomBytes(32).toString('hex');
    const hashedNonce = sha256(rawNonce);

    // IAP 상태 요약
    const buildIapInfo = useCallback(async () => {
      let sub = null;
      try {
        const arr = await getAvailablePurchases();
        sub = Array.isArray(arr)
          ? arr
            .filter(x => x?.productId)
            .sort((a, b) => (b?.expirationDateIOS || 0) - (a?.expirationDateIOS || 0))[0]
          : null;
      } catch (e) {
        // ignore
      }

      const subActive =
        !!sub &&
        typeof sub.expirationDateIOS === 'number' &&
        sub.expirationDateIOS > Date.now();

      const lp = latestPurchase
        ? {
          productId: latestPurchase.productId,
          transactionId: latestPurchase.transactionId,
          transactionDate: latestPurchase.transactionDate,
        }
        : null;

      return {
        platform: Platform.OS,
        connected: !!connected,
        isLoading: !!isLoading,
        subscription: sub
          ? {
            product_id: sub.productId,
            auto_renewing: !!sub.isAutoRenewing,
            expiration_at: sub.expirationDateIOS || null,
            environment: sub.environmentIOS || null,
            transaction_id:
              sub.transactionId ||
              sub.originalTransactionIdentifierIOS ||
              null,
            active: subActive,
          }
          : null,
        latest_purchase: lp,
        last_error: iapError
          ? { code: iapError.code || 'unknown', message: String(iapError.message || iapError) }
          : null,
        ts: Date.now(),
      };
    }, [connected, isLoading, latestPurchase, iapError]);

    // Push: token + foreground
    useEffect(() => {
      (async () => {
        try {
          await messaging().setAutoInitEnabled(true);
          if (!messaging().isDeviceRegisteredForRemoteMessages) {
            await messaging().registerDeviceForRemoteMessages();
          }
          const fcmToken = await messaging().getToken();
          await logPushTokens('init', fcmToken);
          lastPushTokenRef.current = fcmToken;
          sendToWeb('PUSH_TOKEN', {
            token: fcmToken,
            platform: Platform.OS,
            app_version: APP_VERSION,
            install_id: installId ?? 'unknown',
            ts: Date.now(),
          });
          const unsubRefresh = messaging().onTokenRefresh((t) => {
            lastPushTokenRef.current = t;
            sendToWeb('PUSH_TOKEN', { token: t, platform: Platform.OS, app_version: APP_VERSION, install_id: installId ?? 'unknown', ts: Date.now() });
          });
          const unsubMsg = messaging().onMessage(async (remoteMessage) => {
            sendToWeb('PUSH_EVENT', {
              event: 'received',
              title: remoteMessage.notification?.title,
              body: remoteMessage.notification?.body,
              deeplink: remoteMessage.data?.deeplink,
              messageId: remoteMessage.messageId,
              ts: Date.now(),
            });
          });
          return () => { unsubRefresh?.(); unsubMsg?.(); };
        } catch (e) {
          console.log('❌ FCM init error:', e);
        }
      })();
    }, [sendToWeb, installId]);

    const logPushTokens = async (origin, fcmToken) => {
      try {
        console.log(`[PUSH][${origin}] FCM = ${fcmToken}`);
        if (Platform.OS === 'ios') {
          const apns = await messaging().getAPNSToken();
          console.log(`[PUSH][${origin}] APNS = ${apns || '<null>'}`);
        }
      } catch (e) {
        console.log('[PUSH][logPushTokens][err]', e?.message || e);
      }
    };

    // Sign-in handlers (생략 없이 유지)
    const safeSend = (type, payload) => { try { sendToWeb(type, payload); } catch (e) { console.log('[SEND_ERROR]', e); } };
    const handleStartSignin = useCallback(async (payload) => {
      const provider = payload?.provider;
      try {
        if (provider === 'google') {
          if (Platform.OS === 'android') {
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
          }
          try { await GoogleSignin.signOut(); } catch { }
          try { await GoogleSignin.revokeAccess(); } catch { }
          const res = await GoogleSignin.signIn();
          let idToken = res?.idToken;
          if (!idToken) { try { const tokens = await GoogleSignin.getTokens(); idToken = tokens?.idToken || null; } catch { } }
          if (!idToken) throw new Error('no_id_token');
          const googleCredential = auth.GoogleAuthProvider.credential(idToken);
          const userCred = await auth().signInWithCredential(googleCredential);
          logChunked('[SIGNIN][google] signIn() result', res);
          safeSend('SIGNIN_RESULT', {
            success: true, provider: 'google',
            user: { uid: userCred.user.uid, email: userCred.user.email, displayName: userCred.user.displayName, photoURL: userCred.user.photoURL },
            expires_at: Date.now() + 6 * 3600 * 1000,
          });
          return;
        }
        if (provider === 'kakao') {
          if (Platform.OS === 'ios') {
            try {
              let token;
              try { token = await kakaoLoginWithTalkIOS(); }
              catch { token = await kakaoLoginWithAccountIOS(); }
              const me = await kakaoGetProfileIOS().catch(() => ({}));
              safeSend('SIGNIN_RESULT', {
                success: true, provider: 'kakao',
                user: {
                  provider_id: String(me?.id ?? ''),
                  email: me?.email || '',
                  displayName: me?.nickname || me?.profileNickname || '',
                  photoURL: me?.profileImageUrl || me?.thumbnailImageUrl || '',
                },
                tokens: { access_token: token?.accessToken, refresh_token: token?.refreshToken || '' },
                expires_at: Date.now() + 6 * 3600 * 1000,
              });
              return;
            } catch (err) {
              console.log('[KAKAO(iOS) LOGIN ERROR]', err);
              safeSend('SIGNIN_RESULT', { success: false, provider: 'kakao', error_code: err?.code || 'kakao_error', error_message: err?.message || String(err) });
              return;
            }
          }
          if (!kakaoAndroid) {
            safeSend('SIGNIN_RESULT', { success: false, provider: 'kakao', error_code: 'not_supported', error_message: 'Kakao native module missing on Android' });
            return;
          }
          try {
            if (kakaoAndroid.getKeyHash) { const keyHash = await kakaoAndroid.getKeyHash(); console.log('[KAKAO][ANDROID] keyHash =', keyHash); }
            let res;
            if (typeof kakaoAndroid.loginWithKakaoTalk === 'function') res = await kakaoAndroid.loginWithKakaoTalk();
            else if (typeof kakaoAndroid.login === 'function') res = await kakaoAndroid.login();
            else throw new Error('kakao_module_missing_methods');
            safeSend('SIGNIN_RESULT', {
              success: true, provider: 'kakao',
              user: { provider_id: String(res.id), email: res.email || '', displayName: res.nickname || '', photoURL: res.photoURL || '' },
              tokens: { access_token: res.accessToken, refresh_token: res.refreshToken || '' },
              expires_at: Date.now() + 6 * 3600 * 1000,
            });
            return;
          } catch (err) {
            console.log('[KAKAO LOGIN ERROR][ANDROID]', err);
            safeSend('SIGNIN_RESULT', { success: false, provider: 'kakao', error_code: err?.code || 'kakao_error', error_message: err?.message || String(err) });
            return;
          }
        }
        if (provider === 'naver') {
          const { redirectUri, state } = payload || {};
          if (!redirectUri || !state) throw new Error('invalid_payload');
          const ensureSlash = (u) => (u.endsWith('/') ? u : u + '/');
          const ru = ensureSlash(redirectUri);
          const authUrl =
            `${NAVER_AUTH_URL}?response_type=code` +
            `&client_id=${encodeURIComponent(NAVER_CLIENT_ID)}` +
            `&redirect_uri=${encodeURIComponent(ru)}` +
            `&state=${encodeURIComponent(state)}`;
          const js = `location.href='${authUrl.replace(/'/g, "\\'")}'; true;`;
          console.log('[NAVER] authorize URL inject');
          webViewRef.current?.injectJavaScript(js);
          safeSend('NAVER_LOGIN_STARTED', { at: Date.now() });
          return;
        }
        if (provider === 'apple') {
          if (Platform.OS !== 'ios' || !appleAuth?.isSupported) {
            safeSend('SIGNIN_RESULT', { success: false, provider: 'apple', error_code: 'not_supported', error_message: 'iOS only or not supported' });
            return;
          }
          const t0 = Date.now();
          try {
            const rawNonce = randomNonce();
            const hashedNonce = SHA256(rawNonce).toString();
            const res = await appleAuth.performRequest({
              requestedOperation: appleAuth.Operation.LOGIN,
              requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
              nonce: hashedNonce,
            });
            const { user: appleUserId, email, fullName, identityToken } = res || {};
            if (!appleUserId) throw new Error('no_apple_user_id');
            console.log('[APPLE] login ok in', Date.now() - t0, 'ms', 'token?', !!identityToken);
            safeSend('SIGNIN_RESULT', {
              success: true,
              provider: 'apple',
              provider_id: String(appleUserId),
              email: email || '',
              name: fullName ? `${fullName.familyName || ''}${fullName.givenName ? ' ' + fullName.givenName : ''}`.trim() : '',
              meta: { apple_token_present: !!identityToken, first_login_fields_present: !!(email || fullName), at: Date.now() }
            });
            return;
          } catch (err) {
            const canceled = err?.code === appleAuth.Error.CANCELED;
            console.log('[APPLE] login error', canceled ? '(cancelled)' : '', err?.code, err?.message);
            safeSend('SIGNIN_RESULT', {
              success: false, provider: 'apple',
              error_code: canceled ? 'cancelled' : (err?.code || 'apple_error'),
              error_message: err?.message || String(err),
            });
            return;
          }
        }
        throw new Error('unsupported_provider');
      } catch (err) {
        const code = (err && typeof err === 'object' && 'code' in err) ? err.code :
          (String(err?.message || '').includes('no_id_token') ? 'no_id_token' : 'unknown_error');
        const msg = (err && typeof err === 'object' && err.message) || (typeof err === 'string' ? err : JSON.stringify(err));
        console.log('[SIGNIN][ERR]', provider, code, msg);
        safeSend('SIGNIN_RESULT', { success: false, provider, error_code: code, error_message: msg });
      }
    }, [sendToWeb]);

    const handleStartSignout = useCallback(async () => {
      try { await auth().signOut(); sendToWeb('SIGNOUT_RESULT', { success: true }); }
      catch (err) { sendToWeb('SIGNOUT_RESULT', { success: false, error_code: 'signout_error', message: String(err?.message || err) }); }
    }, [sendToWeb]);

    const handleCheckPermission = useCallback(async () => {
      // const push = await ensureNotificationPermission();
      // replyPermissionStatus({ pushGranted: push });
    }, []);

    const handleRequestPermission = useCallback(async () => {
      const push = await ensureNotificationPermission();
      replyPermissionStatus({ pushGranted: push });
    }, [replyPermissionStatus, ensureNotificationPermission]);

    // === IAP 초기 프리페치 (iOS 권장)
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      if (!connected) return;
      (async () => {
        try {
          await fetchProducts({ skus: [IOS_INAPP_BASIC], type: 'inapp' });
          await fetchProducts({ skus: IOS_SUBS_SKUS, type: 'subs' });
          console.log('[IAP][ios] prefetch ok', { prodsLen: products?.length, subsLen: subscriptions?.length });
        } catch (e) {
          console.log('[IAP][ios] prefetch ERR', e?.message || e);
        }
      })();
    }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

    // === latestPurchase 처리 (finishTransaction 포함 + 웹 통지 + 대기 해제) ===
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      const p = latestPurchase;
      if (!p) return;

      try {
        console.log('[IAP][ios][latestPurchase] raw =', JSON.stringify(p, null, 2));
      } catch {
        console.log('[IAP][ios][latestPurchase] <unserializable>', String(p && p.productId));
      }

      const { productId, transactionId } = p;

      (async () => {
        const isConsumable = productId === IOS_INAPP_BASIC;

        try {
          console.log(
            '[IAP][ios] finishTransaction.begin',
            JSON.stringify({ productId, transactionId, isConsumable })
          );

          await finishTransaction({ purchase: p, isConsumable });

          console.log(
            '[IAP][ios] finishTransaction.done',
            JSON.stringify({ productId, transactionId, isConsumable })
          );

          if (isConsumable) {
            const payload = {
              success: true, platform: 'ios', one_time: true,
              product_id: productId, transaction_id: transactionId || null,
            };
            console.log('[IAP][ios->web] PURCHASE_RESULT', JSON.stringify(payload));
            sendIapToWeb('PURCHASE_RESULT', payload);
            notifyIapResult(payload); // ★ 성공: 대기 해제
          } else {
            const payload = {
              success: true, platform: 'ios',
              product_id: productId || '', transaction_id: transactionId || null,
            };
            console.log('[IAP][ios->web] SUBSCRIPTION_RESULT', JSON.stringify(payload));
            sendIapToWeb('SUBSCRIPTION_RESULT', payload);
            notifyIapResult(payload); // ★ 성공: 대기 해제
          }

          endIap();
        } catch (e) {
          const msg = String(e?.message || e);
          const code = e?.code || 'finish_failed';
          console.log(
            '[IAP][ios] finishTransaction.CATCH',
            JSON.stringify({ productId, transactionId, isConsumable, code, msg })
          );

          if (/already|finished|not suitable/i.test(msg)) {
            const payload = {
              success: true, platform: 'ios',
              product_id: p?.productId || '',
              transaction_id: p?.transactionId || null,
              ...(isConsumable ? { one_time: true } : {}),
              note: 'auto-finished-by-native',
            };
            console.log('[IAP][ios->web] (auto-finished) RESULT', JSON.stringify(payload));
            sendIapToWeb(isConsumable ? 'PURCHASE_RESULT' : 'SUBSCRIPTION_RESULT', payload);
            notifyIapResult(payload); // ★ 자동성공: 대기 해제
            endIap();
            return;
          }

          const failPayload = {
            success: false, platform: 'ios',
            product_id: p?.productId || '',
            error_code: code,
            message: msg,
            ...(isConsumable ? { one_time: true } : {}),
          };
          console.log('[IAP][ios->web] RESULT(FAIL)', JSON.stringify(failPayload));
          sendIapToWeb(isConsumable ? 'PURCHASE_RESULT' : 'SUBSCRIPTION_RESULT', failPayload);
          notifyIapResult(failPayload); // ★ 실패: 대기 해제
          endIap();
        }
      })();
    }, [latestPurchase, finishTransaction, notifyIapResult, sendIapToWeb]);

    // === iapError (실패/취소/이미 보유) — 종류에 맞춰 전송 + 대기 해제 ===
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      if (!iapError) return;

      console.log('[IAP][error.effect]', iapError?.code, String(iapError?.message || iapError), 'kind=', iapKindRef.current, 'sku=', iapSkuRef.current);

      const payload = {
        success: false,
        platform: 'ios',
        product_id: iapSkuRef.current || '',
        error_code: iapError?.code || 'purchase_error',
        message: iapError?.message || String(iapError),
        cancelled: String(iapError?.code || '').toLowerCase().includes('cancel'),
      };
      const type = (iapKindRef.current === 'inapp') ? 'PURCHASE_RESULT' : 'SUBSCRIPTION_RESULT';
      console.log('[IAP][toWeb.error]', type, JSON.stringify(payload));
      sendIapToWeb(type, payload);
      notifyIapResult(payload); // ★ 추가: 에러도 대기 해제
      endIap();
    }, [iapError, notifyIapResult, sendIapToWeb]);

    // ─────────── onMessageFromWeb ───────────
    const onMessageFromWeb = useCallback(async (e) => {
      try {
        const raw = e.nativeEvent.data;
        if (typeof raw === 'string' && raw.startsWith('open::')) { const url = raw.replace('open::', ''); try { await Linking.openURL(url); } catch { } return; }
        const data = JSON.parse(raw);
        console.log('[WEB][msg]', data?.type);

        switch (data.type) {
          case 'GET_INSTALLATION_ID': {
            console.log('[WEB] GET_INSTALLATION_ID → send INSTALLATION_ID');
            sendToWeb('INSTALLATION_ID', { install_id: installId ?? 'unknown', ts: Date.now() });
            break;
          }
          case 'WEB_READY': await handleWebReady(); break;

          case 'GET_IAPINFO': {
            console.log('[IAP] GET_IAPINFO');
            try {
              const info = await buildIapInfo();
              sendIapToWeb('IAPINFO', info);
            } catch (e) {
              sendIapToWeb('IAPINFO', {
                platform: Platform.OS,
                success: false,
                error_code: e?.code || 'iapinfo_failed',
                message: String(e?.message || e),
                ts: Date.now(),
              });
            }
            break;
          }

          case 'WEB_IAP_READY': {
            webIapReadyRef.current = true;
            try {
              const cnt = webIapQueueRef.current.length;
              console.log('[WEB_IAP_READY] flush queued msgs =', cnt);
              while (webIapQueueRef.current.length) {
                const s = webIapQueueRef.current.shift();
                webViewRef.current?.postMessage(s);
              }
            } catch (err) {
              console.log('[WEB_IAP_READY][flush][ERR]', err?.message || err);
            }
            sendToWeb('WEB_IAP_READY_ACK', { at: Date.now() });
            break;
          }

          case 'WEB_ERROR': await handleWebError(data.payload); break;

          case 'CHECK_PERMISSION': { break; }
          case 'REQUEST_PERMISSION': {
            const push = await ensureNotificationPermission();
            replyPermissionStatus({ pushGranted: push });
            break;
          }

          case 'RESTORE_SUBSCRIPTIONS': {
            if (Platform.OS === 'ios') {
              try {
                console.log('[IAP] restorePurchases()');
                await restorePurchases();
                sendIapToWeb('SUBSCRIPTION_RESTORED', { success: true, platform: 'ios' });
              } catch (e) {
                console.log('[IAP][restore][ERR]', e?.code, e?.message);
                sendIapToWeb('SUBSCRIPTION_RESTORED', {
                  success: false, platform: 'ios',
                  error_code: e?.code || 'restore_failed',
                  message: String(e?.message || e),
                });
              }
            }
            break;
          }

          case 'START_SUBSCRIPTION': {
            const sku = data?.payload?.product_id;
            console.log('[IAP][start.subs.wait]', sku);
            beginIap('subscription', { sku });
            try {
              await fetchProducts({ skus: [sku], type: 'subs' });
              await requestPurchase({ type: 'subs', request: { ios: { sku } } });
            } catch (e) {
              const fail = {
                success: false,
                platform: 'ios',
                product_id: sku,
                error_code: e?.code || 'start_failed',
                message: String(e?.message || e),
              };
              sendIapToWeb('SUBSCRIPTION_RESULT', fail);
              notifyIapResult(fail); // 즉시 실패 시 대기 해제
              break;
            }

            const raceWait = waitIapResult(12000);
            const racePoll = (async () => {
              for (let i = 0; i < 12; i++) {
                const snap = await probeLatestBySnapshot(sku);
                if (snap && snap.transactionId) {
                  const payload = { success: true, platform: 'ios', product_id: snap.productId, transaction_id: snap.transactionId };
                  sendIapToWeb('SUBSCRIPTION_RESULT', payload);
                  notifyIapResult(payload);
                  return payload;
                }
                await new Promise(r => setTimeout(r, 1000));
              }
              return null;
            })();
            const finalRes = (await Promise.race([raceWait, racePoll])) || { success: false, platform: 'ios', product_id: sku, error_code: 'timeout', message: 'iap_result_timeout' };
            console.log('[IAP][INAPP][FINAL_SEND]', JSON.stringify({ ...finalRes, waited: true }));
            sendToWeb('SUBSCRIPTION_RESULT', { ...finalRes, waited: true, at: Date.now() })
            break;
          }

          case 'START_ONE_TIME_PURCHASE': {
            const sku = data?.payload?.product_id;
            console.log('[IAP][start.inapp.wait]', sku);
            beginIap('one_time', { sku });
            try {
              await fetchProducts({ skus: [sku], type: 'inapp' });
              await requestPurchase({ type: 'inapp', request: { ios: { sku } } });
            } catch (e) {
              const fail = {
                success: false,
                platform: 'ios',
                one_time: true,
                product_id: sku,
                error_code: e?.code || 'start_failed',
                message: String(e?.message || e),
              };
              sendIapToWeb('PURCHASE_RESULT', fail);
              notifyIapResult(fail);
              break;
            }
            const raceWait = waitIapResult(12000);
            const racePoll = (async () => {
              for (let i = 0; i < 12; i++) {
                const snap = await probeLatestBySnapshot(sku);
                if (snap && snap.transactionId) {
                  const payload = { success: true, platform: 'ios', one_time: true, product_id: snap.productId, transaction_id: snap.transactionId };
                  sendIapToWeb('PURCHASE_RESULT', payload);
                  notifyIapResult(payload);
                  return payload;
                }
                await new Promise(r => setTimeout(r, 1000));
              }
              return null;
            })();
            const finalRes = (await Promise.race([raceWait, racePoll])) || { success: false, platform: 'ios', one_time: true, product_id: sku, error_code: 'timeout', message: 'iap_result_timeout' };
            console.log('[IAP][INAPP][FINAL_SEND]', JSON.stringify({ ...finalRes, waited: true }));
            sendToWeb('PURCHASE_RESULT', { ...finalRes, waited: true, at: Date.now() });
            break;
          }

          case 'MANAGE_SUBSCRIPTION': {
            console.log('[IAP] openManageSubscriptionIOS()');
            await openManageSubscriptionIOS();
            break;
          }

          case 'START_SHARE': {
            try {
              const { image, caption, platform } = data.payload || {};
              await Share.open({ title: '공유', message: caption ? `${caption}\n` : undefined, url: image, failOnCancel: false });
              sendToWeb('SHARE_RESULT', { success: true, platform, post_id: null });
            } catch (err) {
              sendToWeb('SHARE_RESULT', { success: false, platform: data?.payload?.platform, error_code: 'share_failed', message: String(err?.message || err) });
            }
            break;
          }

          case 'share.toChannel': { await handleShareToChannel(data, sendToWeb); break; }

          case 'DOWNLOAD_IMAGE': {
            try {
              const { url, dataUrl, filename } = data.payload || {};
              const safeName = filename && filename.includes('.') ? filename : 'image.jpg';
              if (url) await downloadAndSaveToGallery(url, safeName);
              else if (dataUrl) await saveDataUrlToGallery(dataUrl, safeName);
              else throw new Error('no_url_or_dataUrl');
              sendToWeb('DOWNLOAD_RESULT', { success: true, filename: safeName });
              sendToWeb('TOAST', { message: '이미지가 갤러리에 저장되었습니다.' });
            } catch (err) {
              console.log('[DOWNLOAD_IMAGE][error]', err);
              sendToWeb('DOWNLOAD_RESULT', { success: false, error_code: 'save_failed', message: String(err?.message || err) });
              sendToWeb('TOAST', { message: `이미지 저장 실패: ${String(err?.message || err)}` });
            }
            break;
          }

          case 'GET_PUSH_TOKEN': {
            try {
              let fcm = lastPushTokenRef.current || token || '';

              if (!fcm) {
                await messaging().setAutoInitEnabled(true);
                if (!messaging().isDeviceRegisteredForRemoteMessages) {
                  await messaging().registerDeviceForRemoteMessages();
                }

                // APNS 토큰 대기 (최대 10초)
                let apns = null;
                for (let i = 0; i < 20; i++) {
                  apns = await messaging().getAPNSToken();
                  if (apns) break;
                  await new Promise(r => setTimeout(r, 500));
                }
                console.log('[PUSH][GET_PUSH_TOKEN] APNS =', apns || '<null>');

                if (apns) {
                  fcm = await messaging().getToken();
                  lastPushTokenRef.current = fcm;
                }
              }

              sendToWeb('PUSH_TOKEN', {
                token: fcm || '',
                platform: Platform.OS,
                app_version: APP_VERSION,
                install_id: installId ?? 'unknown',
                ts: Date.now(),
              });
            } catch (err) {
              sendToWeb('PUSH_TOKEN', {
                token: '',
                platform: Platform.OS,
                app_version: APP_VERSION,
                install_id: installId ?? 'unknown',
                ts: Date.now(),
                error: String(err?.message || err),
              });
            }
            break;
          }

          case 'START_SIGNIN': await handleStartSignin(data.payload); break;
          case 'START_SIGNOUT': await handleStartSignout(); break;

          case 'EXIT_APP': BackHandler.exitApp(); break;

          case 'NAV_STATE': {
            const nav = data.payload || {};
            lastNavStateRef.current = {
              isRoot: !!nav.isRoot,
              path: nav.path ?? '',
              canGoBackInWeb: nav.canGoBackInWeb === true || nav.canGoBack === true,
              hasBlockingUI: !!nav.hasBlockingUI,
              needsConfirm: !!nav.needsConfirm,
            };
            sendToWeb('NAV_STATE_ACK', { nav: lastNavStateRef.current, at: Date.now() });
            break;
          }

          case 'BACK_PRESSED': {
            const nav = lastNavStateRef.current || {};
            if (nav.isRoot === true) {
              sendToWeb('APP_EXIT_REQUEST', { at: Date.now() });
            } else {
              sendToWeb('BACK_REQUEST', { nav, at: Date.now() });
            }
            break;
          }

          case 'NAVER_LOGIN_DONE': {
            const payload = data.payload || {};
            const ok = !!payload.success;
            const err = payload.error || payload.error_code || null;
            console.log(`[NAVER_LOGIN_DONE] success=${ok} ${err ? `error=${err}` : ''}`);
            logChunked('[NAVER_LOGIN_DONE] payload', payload);
            sendToWeb('NAVER_LOGIN_ACK', { success: ok, at: Date.now(), error: err || undefined });
            break;
          }

          case 'NAVER_DEBUG': {
            logChunked('[NAVER_DEBUG data]', data);
            logChunked('[NAVER_DEBUG payload]', data.payload);
            break;
          }

          default: console.log('⚠️ unknown msg:', data.type);
        }
      } catch (err) {
        console.error('❌ onMessage error:', err);
      }
    }, [
      sendToWeb, installId, handleWebReady, handleWebError,
      buildIapInfo, fetchProducts, requestPurchase, restorePurchases,
      ensureNotificationPermission, replyPermissionStatus,
      handleStartSignin, handleStartSignout
    ]);

    const onWebViewLoadStart = useCallback(() => {
      webIapReadyRef.current = false;
      console.log('[WEBVIEW] loadStart');

      showSplashOnce();
      if (bootTORef.current) clearTimeout(bootTORef.current);
      bootTORef.current = setTimeout(() => {
        console.log('[WEBVIEW] boot timeout → OFFLINE_FALLBACK');
        sendToWeb('OFFLINE_FALLBACK', { reason: 'timeout', at: Date.now() });
      }, BOOT_TIMEOUT_MS);
    }, [showSplashOnce, sendToWeb]);

    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
          <WebView
            ref={webViewRef}
            source={{ uri: 'http://www.wizmarket.ai/ads/start' }} // 가능하면 https
            onMessage={onMessageFromWeb}
            onLoadStart={onWebViewLoadStart}
            onLoadProgress={({ nativeEvent }) => {
              console.log('[WEBVIEW] progress', nativeEvent.progress);
              if (nativeEvent.progress >= 0.9) hideSplashRespectingMin();
            }}
            onLoadEnd={() => {
              console.log('[WEBVIEW] loadEnd');
              hideSplashRespectingMin();
            }}
            javaScriptEnabled
            domStorageEnabled
            focusable
            overScrollMode="never"
            containerStyle={{ backgroundColor: 'transparent', flex: 1 }}
            style={{ backgroundColor: 'transparent', flex: 1 }}
          />
          {/* 필요시 스플래시 복원
        {splashVisible && (
          <SafeAreaInsetOverlay opacity={splashFade}>
            <SplashScreenRN brandBg="#FFFFFF" brandText="#111111" primary="#111111" brandName="wizmarket" />
          </SafeAreaInsetOverlay>
        )} */}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  };

  function SafeAreaInsetOverlay({ opacity, children }) {
    const insets = useSafeAreaInsets();
    return (
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { opacity, backgroundColor: 'white', paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {children}
      </Animated.View>
    );
  }

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
  });

  export default App;
