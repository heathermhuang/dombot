/** Shared account presentation; authentication and legal forms keep their contracts. */
export const accountStyles = `
body:not(.landing-page){--paper:#f3f4ee;--ink:#20382c;--muted:#5c6b61;--line:#d8e0d6;--green:#2a5b3d}
body:not(.landing-page)>header{align-items:center;padding-block:22px;border-bottom:0}
body:not(.landing-page)>header>a:last-child:not(.brand){font-size:13px;font-weight:600;padding:10px 16px;border:1px solid var(--line);border-radius:8px;background:#ffffff80}
body:not(.landing-page)>main{min-height:calc(100svh - 210px)}
body:not(.landing-page) main>form,body:not(.landing-page) .account{max-width:560px;margin:32px auto 64px;padding:40px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 64px -40px #20382c50}
body:not(.landing-page) main>form{max-width:500px}
body:not(.landing-page) h1{font-size:clamp(30px,4vw,38px);line-height:1.15;letter-spacing:-.045em;margin:16px 0}
body:not(.landing-page) form>p{font-size:14px;line-height:1.75}
body:not(.landing-page) .eyebrow{font-size:11px;font-weight:600;letter-spacing:.12em}
body:not(.landing-page) input:not([type=checkbox]):not([type=hidden]){border-radius:8px;min-height:48px;background:#fafbf8;transition:border-color 160ms,box-shadow 160ms}
body:not(.landing-page) input:focus-visible{border-color:var(--green);box-shadow:0 0 0 4px #31613b12;outline:2px solid var(--green);outline-offset:2px}
body:not(.landing-page) button,body:not(.landing-page) .button{border-radius:8px;font-size:14px;font-weight:600;transition:background-color 160ms,box-shadow 160ms;line-height:1.5}
body:not(.landing-page) button:hover{background:#214931;box-shadow:0 4px 12px -6px #20382c70}
body:not(.landing-page) main>form>button[type=submit]{width:100%;min-height:48px;margin-top:8px}
body:not(.landing-page) .note{font-size:12px;line-height:1.75}
body:not(.landing-page) .error{background:#fcf1ee;border-color:#e3bcb2}
body:not(.landing-page) .notice{background:#eff5ed;border-color:#d4e2ce}
body:not(.landing-page) .legal{padding:24px 0}
body:not(.landing-page)>footer{padding-top:24px;padding-bottom:24px}
.skip-link{position:absolute;left:20px;top:-80px;z-index:10;padding:12px 20px;background:var(--ink);color:#fff;border-radius:6px}
.skip-link:focus{top:12px}
@media(max-width:600px){body:not(.landing-page)>header{padding-block:14px;gap:8px}body:not(.landing-page)>header>a:last-child:not(.brand){padding:8px 10px}body:not(.landing-page) main>form,body:not(.landing-page) .account{padding:26px 22px;margin:12px auto 36px;border-radius:12px}body:not(.landing-page)>main{padding-top:12px}body:not(.landing-page) .legal{padding:8px 0}}
@media(prefers-reduced-motion:reduce){body:not(.landing-page) input,body:not(.landing-page) button{transition:none}}
`;
