"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import aiLogo from "@/img/AI.png";
import companyLogo from "@/img/image(1).svg";

const TERMS_STORAGE_KEY = "geo-service-terms-accepted-at";
const HERO_PREFIX_TEXT = "让";
const HERO_SUFFIX_TEXT = "主动推荐你的品牌";
const ENTERPRISE_ROUTE = "/enterprise";
const START_EXIT_DURATION_MS = 280;
const ROUTE_FALLBACK_DELAY_MS = 600;

function renderBounceChars(text: string, startIndex = 0) {
  return Array.from(text).map((char, index) => (
    <span
      key={`${char}-${startIndex + index}`}
      className="geo-startup-bounce-char"
      style={{ "--geo-char-index": startIndex + index } as CSSProperties}
      aria-hidden="true"
    >
      {char}
    </span>
  ));
}

export function StartupScreen() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationTimerRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    router.prefetch(ENTERPRISE_ROUTE);
    return () => {
      if (navigationTimerRef.current !== null) {
        window.clearTimeout(navigationTimerRef.current);
      }
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [router]);

  function navigateToEnterprise() {
    router.push(ENTERPRISE_ROUTE);
    fallbackTimerRef.current = window.setTimeout(() => {
      if (window.location.pathname !== ENTERPRISE_ROUTE) {
        window.location.assign(ENTERPRISE_ROUTE);
      }
    }, ROUTE_FALLBACK_DELAY_MS);
  }

  function handleStart() {
    if (isNavigating) {
      return;
    }
    window.localStorage.setItem(TERMS_STORAGE_KEY, new Date().toISOString());
    setIsNavigating(true);
    navigationTimerRef.current = window.setTimeout(() => {
      navigateToEnterprise();
    }, START_EXIT_DURATION_MS);
  }

  return (
    <main
      className={`geo-startup-main relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8${isNavigating ? " geo-startup-main-exit" : ""}`}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/14 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
        <div className="geo-startup-brand-mark absolute left-0 top-0">
          <Image
            src={companyLogo}
            alt="公司 Logo"
            priority
            className="h-12 w-[90px] object-contain"
          />
        </div>

        <section className="flex w-full max-w-4xl flex-col items-center text-center">
          <h1
            className="max-w-4xl text-center font-display text-4xl font-semibold leading-[1.22] tracking-tight text-ink sm:text-5xl lg:text-7xl"
            aria-label="让 AI 主动推荐你的品牌"
          >
            <span className="geo-startup-bounce-text">{renderBounceChars(HERO_PREFIX_TEXT)}</span>
            <span className="mx-2 inline-flex shrink-0 items-end overflow-visible px-[0.05em] py-[0.08em] align-[-0.02em] sm:mx-3">
              <Image
                src={aiLogo}
                alt=""
                aria-hidden="true"
                priority
                className="geo-startup-logo-reveal block h-[1.28em] w-auto max-w-none object-contain"
              />
            </span>
            <span className="geo-startup-bounce-text">{renderBounceChars(HERO_SUFFIX_TEXT, HERO_PREFIX_TEXT.length)}</span>
          </h1>

          <div className="geo-startup-copy-2 mt-12 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={handleStart}
              disabled={isNavigating}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-8 py-3 text-base font-semibold text-white transition-all duration-300 ease-out focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:pointer-events-none ${
                isNavigating
                  ? "scale-[0.96] opacity-90"
                  : "hover:bg-accent-soft active:scale-[0.98]"
              }`}
            >
              {isNavigating ? "正在进入" : "立即使用"}
              <ArrowRight className="h-4 w-4" />
            </button>
            <p className="max-w-[22rem] text-center text-xs leading-5 text-muted">
              点击「立即使用」即表示你已阅读并同意
              <Link className="mx-1 font-medium text-accent underline underline-offset-4 transition hover:text-accent-soft" href="/service-terms">
                极EO服务条款
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
