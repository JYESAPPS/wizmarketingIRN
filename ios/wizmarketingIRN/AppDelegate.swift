import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore

// Kakao iOS SDK를 붙인 경우에만 주석 해제
import KakaoSDKCommon
import KakaoSDKAuth

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

  var window: UIWindow?

  // RN 0.81 템플릿 구조
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  // MARK: - Application Lifecycle
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {

    // Firebase 초기화 (중복 호출 방지)
    if FirebaseApp.app() == nil {
      FirebaseApp.configure()
    }

    // Kakao iOS SDK를 사용할 경우 주석 해제
    KakaoSDK.initSDK(appKey: "ef66c5836528d39100550fd6ca87f7dc")

    // React Native 부트스트랩
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "wizmarketingIRN",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // MARK: - URL / Deeplink (iOS 9+)
  // ✅ 구글/애플/기타 URL 스킴 콜백은 RN으로 전달
  func application(_ app: UIApplication,
                   open url: URL,
                   options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {

    // Kakao iOS SDK 사용 시 먼저 처리 (SDK 추가 후 주석 해제)
    if AuthApi.isKakaoTalkLoginUrl(url) {
      return AuthController.handleOpenUrl(url: url)
    }

    // RN Linking으로 전달 (Google Sign-In 포함)
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  // MARK: - UIScene (iOS 13+) — SceneDelegate를 사용할 때만 호출됨
  // 프로젝트에 SceneDelegate.swift가 있다면 아래 확장을 그대로 두세요.
  // SceneDelegate가 없다면 이 블록은 무시됩니다.
}

// MARK: - ReactNativeDelegate (RN 0.81 템플릿)
class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    #if DEBUG
      return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}

// MARK: - SceneDelegate openURL 전달 (SceneDelegate가 존재하는 프로젝트만)
#if canImport(UIKit)
import UIKit
extension UIResponder {
  // 빈 확장: 파일 분리 없이 Scene openURL 전달용 확장만 아래에 둠
}
#endif

// 만약 프로젝트에 별도의 SceneDelegate.swift가 있고 openURL 전달이 필요하면
// 해당 파일에 아래 메서드를 추가하세요.
/*
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let ctx = URLContexts.first else { return }

    // Kakao iOS SDK 사용 시 먼저 처리 (SDK 추가 후 주석 해제)
    // if AuthApi.isKakaoTalkLoginUrl(ctx.url) {
    //   AuthController.handleOpenUrl(url: ctx.url)
    //   return
    // }

    _ = RCTLinkingManager.application(
      UIApplication.shared,
      open: ctx.url,
      options: ctx.options
    )
  }
}
*/
