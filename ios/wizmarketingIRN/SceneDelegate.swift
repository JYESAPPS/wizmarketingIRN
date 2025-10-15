// SceneDelegate.swift
import UIKit
import React
import KakaoSDKAuth   // ← 중요

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let ctx = URLContexts.first else { return }
    let url = ctx.url

    // 1) 카카오 로그인 복귀 처리 (먼저)
    if AuthApi.isKakaoTalkLoginUrl(url) {
      print("[KAKAO][OPENURL] \(url.absoluteString)")

      AuthController.handleOpenUrl(url: url)
      return
    }
    print("[LINKING][OPENURL] \(url.absoluteString)")

    // 2) RN Linking으로 기타 URL 전달
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      open: url,
      options: ctx.options
    )
      // ✅ 새로 추가: Universal Link(https) 복귀 처리
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
          let url = userActivity.webpageURL else {
      // RN으로도 전달 (다른 UL 딥링크 케이스)
      RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: nil)
      return
    }

    // 카카오톡이 UL로 복귀한 경우 SDK로 먼저 전달
    if AuthApi.isKakaoTalkLoginUrl(url) {
      print("[KAKAO][UL] \(url.absoluteString)")
      AuthController.handleOpenUrl(url: url)
      return
    }

    // 그 외 UL은 RN으로
    RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: nil)
    }
  }
}
