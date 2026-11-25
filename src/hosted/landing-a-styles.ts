/** Owner-selected direction A: MCP first. Scoped to the public landing page. */
export const landingAStyles = `
.landing-page{--ink:#193a2a;--forest:#245d3f;--muted:#68796d;--line:#dce4db;--mint:#edf3e9;--paper:#f8faf6;--white:#fff;--radius:16px;font-family:Archivo,system-ui,sans-serif;color:var(--ink);background:var(--paper);font-synthesis:none}
.landing-page *{box-sizing:border-box}.landing-page{margin:0;font-size:15px;line-height:1.6}.landing-page button,.landing-page input,.landing-page textarea{font:inherit}.landing-page button,.landing-page a{-webkit-tap-highlight-color:transparent}.landing-page a{color:inherit;text-decoration:none}.landing-page button{cursor:pointer}.landing-page button:focus-visible,.landing-page a:focus-visible,.landing-page input:focus-visible,.landing-page textarea:focus-visible{outline:3px solid #81a18d;outline-offset:4px}.landing-page button:disabled{cursor:default}.landing-page svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.landing-page .container{width:min(1240px,calc(100% - 96px));margin-inline:auto}.landing-page .site-nav{height:96px;display:flex;align-items:center;justify-content:space-between;gap:36px}.landing-page .brand{font-size:25px;letter-spacing:-1.45px;font-weight:700;white-space:nowrap}.landing-page .brand span{color:#6b8f74}.landing-page .nav-center{display:flex;gap:30px;font-size:13px;color:var(--muted)}.landing-page .nav-actions{display:flex;align-items:center;gap:24px;font-size:13px}.landing-page .btn{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:46px;padding:11px 21px;border:1px solid var(--forest);border-radius:9px;background:var(--forest);color:#fff;font-weight:600;font-size:13px;white-space:nowrap;transition:background .18s,transform .18s}.landing-page .btn:hover{background:#194c31}.landing-page .btn:active{transform:translateY(1px)}.landing-page .btn-light{color:var(--ink);background:var(--white);border-color:var(--line)}.landing-page .btn-light:hover{background:var(--mint)}.landing-page .text-link{font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:7px;min-height:44px}.landing-page .text-link svg{width:15px;height:15px}.landing-page .eyebrow{font-size:12px;font-weight:500;color:var(--forest);display:flex;align-items:center;gap:8px;margin:0 0 23px}.landing-page .status-dot{width:6px;height:6px;border-radius:50%;background:#649d76;display:inline-block;flex:none}.landing-page h1,.landing-page h2,.landing-page h3,.landing-page p{margin:0}.landing-page h1{font-size:clamp(42px,4.7vw,62px);line-height:1.08;font-weight:600;letter-spacing:-2.7px;text-wrap:balance}.landing-page h1 em{font-style:normal;color:#5f8666}.landing-page h2{font-size:38px;line-height:1.15;letter-spacing:-1.4px;font-weight:600;text-wrap:balance}.landing-page h3{font-weight:600;font-size:17px;letter-spacing:-.4px}.landing-page .lead{font-size:16px;line-height:1.75;color:var(--muted);max-width:37ch;margin-top:24px}.landing-page .hero-actions{display:flex;align-items:center;gap:22px;margin-top:28px}.landing-page .free-note{font-size:11px;color:var(--muted);margin-top:17px}.landing-page .small{font-size:11px;color:var(--muted)}.landing-page .sample{font-size:10px;font-weight:500;border:1px solid var(--line);padding:3px 7px;border-radius:4px;line-height:1.3;color:var(--muted);background:#f8faf6;white-space:nowrap}.landing-page .site-footer{display:flex;justify-content:space-between;align-items:center;gap:30px;padding:32px 0 36px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}.landing-page .site-footer nav{display:flex;gap:20px}.landing-page .concept-notice{font-size:11px;color:var(--muted);margin-bottom:18px;display:flex;align-items:center;gap:8px}.landing-page .concept-notice span{border:1px solid var(--line);padding:2px 6px;border-radius:4px}
.landing-page .hero-a{display:grid;grid-template-columns:1fr 1.42fr;gap:56px;align-items:center;padding:42px 0 58px}.landing-page .hero-a h1{max-width:450px;font-size:50px;letter-spacing:-2.1px;line-height:1.12}.landing-page .hero-a .lead{max-width:34ch}.landing-page .portfolio-window{background:white;border:1px solid #d7e1d5;border-radius:14px;box-shadow:0 16px 40px -24px #183c2c35;overflow:hidden}.landing-page .window-header{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--line);gap:20px}.landing-page .window-brand{display:flex;gap:9px;align-items:center;font-size:12px;font-weight:600}.landing-page .window-brand .glyph{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;background:var(--mint);color:var(--forest)}.landing-page .window-brand .glyph svg{width:13px;height:13px}.landing-page .window-tools{display:flex;align-items:center;gap:14px;color:#829187}.landing-page .window-tools svg{width:14px;height:14px}.landing-page .portfolio-body{display:grid;grid-template-columns:112px minmax(0,1fr)}.landing-page .side-nav{padding:22px 10px;background:#fafbf8;border-right:1px solid #e8eee5;font-size:10px;color:var(--muted);display:flex;flex-direction:column;gap:7px}.landing-page .side-nav span{display:flex;align-items:center;gap:6px;padding:8px 6px;white-space:nowrap}.landing-page .side-nav svg{width:13px;height:13px}.landing-page .side-nav .active{background:#eaf1e5;border-radius:6px;color:var(--forest);font-weight:600}.landing-page .side-bottom{margin-top:auto;color:#869488;font-size:9px}.landing-page .portfolio-main{padding:16px 20px 14px;min-width:0}.landing-page .window-title{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.landing-page .window-title h3{font-size:20px;letter-spacing:-.8px}.landing-page .window-title .small{font-size:10px}.landing-page .mini-search{display:flex;align-items:center;gap:7px;color:#869188;font-size:10px;border:1px solid #e1e7de;padding:5px 8px;border-radius:5px;margin-bottom:10px}.landing-page .mini-search svg{width:12px;height:12px}.landing-page .data-table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;white-space:nowrap}.landing-page .data-table th{font-size:11px;font-weight:600;color:#4d6354;padding:9px 4px;border-bottom:1px solid var(--line)}.landing-page .data-table td{padding:8px 4px;border-bottom:1px solid #edf1eb}.landing-page .data-table td:first-child{font-weight:600;letter-spacing:-.2px}.landing-page .data-table td:not(:first-child){color:#4d6354}.landing-page .data-table td.renew-soon{color:#875315;font-weight:600}.landing-page .registrar-mobile{display:none}.landing-page .data-table .cell-price{text-align:right}.landing-page .data-table .selected-row{background:#f3f7ef}.landing-page .domain-symbol{color:#75917b;font-size:10px;margin-right:6px}.landing-page .inline-note{margin-top:10px;color:#4d6354;font-size:11px}.landing-page .brand-strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:28px 0;display:flex;align-items:center;gap:34px}.landing-page .brand-strip p{font-size:12px;max-width:180px;color:var(--muted);line-height:1.5}.landing-page .brand-list{flex:1;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap}.landing-page .brand-list span{font-size:15px;letter-spacing:-.5px;font-weight:600;color:#577160}.landing-page .brand-list .count{font-size:11px;color:var(--muted);font-weight:400;letter-spacing:0}
.landing-page .inquiry-section{padding:86px 0 82px;display:grid;grid-template-columns:.85fr 1.15fr;gap:90px;align-items:center}.landing-page .section-copy .lead{margin-top:19px;font-size:15px;max-width:36ch}.landing-page .section-kicker{font-size:12px;color:var(--forest);font-weight:500;margin-bottom:16px}.landing-page .inquiry-note{margin-top:27px;display:flex;align-items:flex-start;gap:10px;font-size:12px;color:var(--muted)}.landing-page .inquiry-note svg{flex:none;color:var(--forest);margin-top:2px;width:15px;height:15px}.landing-page .inquiry-product{display:grid;grid-template-columns:.9fr 1.1fr;gap:0;min-width:0;border:1px solid #d6e1d4;background:white;border-radius:14px;overflow:hidden;box-shadow:0 17px 36px -30px #1d412d45}.landing-page .domain-landing{padding:27px 22px 25px;background:#edf3e7;display:flex;flex-direction:column;align-items:flex-start;min-width:0}.landing-page .domain-landing .small{font-size:9px}.landing-page .domain-landing h3{font-size:33px;font-weight:500;letter-spacing:-1.4px;line-height:1.1;margin:41px 0 13px}.landing-page .domain-landing p{font-size:11px;line-height:1.7;color:#6a7f6c;max-width:22ch}.landing-page .domain-landing button{border:0;border-radius:6px;background:#2b603f;color:white;padding:10px 13px;font-size:10px;font-weight:500;min-height:37px;margin-top:23px;display:flex;align-items:center;gap:12px}.landing-page .domain-landing button svg{width:12px;height:12px}.landing-page .public-domain-caption{margin-top:42px;font-size:8px;color:#8a9c88}.landing-page .inquiry-owner{padding:22px 20px}.landing-page .inquiry-owner-header{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;padding-bottom:17px;border-bottom:1px solid #e3e9df;margin-bottom:18px}.landing-page .inquiry-owner-header span:last-child{font-size:9px;background:#edf3e7;border-radius:4px;padding:2px 5px;color:var(--forest)}.landing-page .inquiry-domain{font-size:10px;color:var(--muted);margin-bottom:8px}.landing-page .inquiry-message{border:1px solid #e3e9df;border-radius:7px;background:#fafbf8;padding:13px;font-size:11px;line-height:1.65;color:#536b5b}.landing-page .inquiry-message .meta{font-size:8px;color:#89968b;margin-bottom:7px}.landing-page .inquiry-status{display:flex;align-items:center;gap:5px;color:var(--forest);font-size:9px;margin-top:16px}.landing-page .inquiry-status svg{width:12px;height:12px}.landing-page .inquiry-bottom{border-top:1px solid #e5ebe1;padding-top:14px;margin-top:24px;font-size:9px;color:#8a978e}.landing-page .sample-form label{font-size:9px;display:block;color:var(--muted);margin-top:8px}.landing-page .sample-form input,.landing-page .sample-form textarea{width:100%;border:1px solid #dce5d9;border-radius:4px;padding:7px 8px;background:#fff;font-size:11px;color:var(--ink);min-height:33px}.landing-page .sample-form textarea{height:58px;resize:none}.landing-page .sample-form button{font-size:10px;padding:7px 10px;margin-top:9px;min-height:32px}.landing-page .sample-feedback{font-size:10px;color:var(--forest);margin-top:12px}.landing-page .inquiry-owner [hidden]{display:none}.landing-page .product-caption{font-size:10px;color:var(--muted);margin-top:13px;display:flex;justify-content:space-between;gap:14px}.landing-page .inquiry-visual{min-width:0}.landing-page .simple-close{border-top:1px solid var(--line);padding:48px 0;display:flex;justify-content:space-between;align-items:center;gap:30px}.landing-page .simple-close h2{font-size:29px}.landing-page .simple-close p{font-size:13px;color:var(--muted);margin-top:10px}.landing-page .simple-close .btn{flex:none}
@media(min-width:1400px){.landing-page .hero-a{gap:74px}}
@media(max-width:1050px){.landing-page .container{width:calc(100% - 64px)}.landing-page .hero-a{gap:32px;grid-template-columns:.85fr 1.15fr}.landing-page .hero-a h1{font-size:48px;letter-spacing:-2px}.landing-page .portfolio-body{grid-template-columns:1fr}.landing-page .side-nav{display:none}.landing-page .portfolio-main{padding:16px 18px 14px}.landing-page .inquiry-section{gap:45px}.landing-page .inquiry-product{grid-template-columns:1fr 1fr}}
@media(max-width:800px){.landing-page .hero-a{grid-template-columns:1fr;padding-top:35px;gap:42px}.landing-page .hero-a h1{font-size:52px;max-width:600px}.landing-page .hero-a .lead{max-width:50ch}.landing-page .brand-strip{display:block}.landing-page .brand-strip p{max-width:none;margin-bottom:20px}.landing-page .brand-list{justify-content:flex-start;gap:22px 30px}.landing-page .inquiry-section{grid-template-columns:1fr;gap:35px;padding:55px 0}.landing-page .section-copy h2{max-width:560px}.landing-page .section-copy .lead{max-width:52ch}.landing-page .inquiry-product{max-width:630px}.landing-page .inquiry-note{margin-top:18px}}
@media(max-width:600px){.landing-page .container{width:calc(100% - 40px)}.landing-page .brand{font-size:23px}.landing-page .nav-actions{gap:13px;font-size:12px}.landing-page .nav-actions .btn{display:none}.landing-page .concept-notice{font-size:10px;margin-top:7px}.landing-page .hero-a{padding-top:22px;padding-bottom:32px;gap:26px}.landing-page .eyebrow{font-size:11px;margin-bottom:18px}.landing-page .hero-a h1{font-size:clamp(34px,11vw,43px);line-height:1.1;letter-spacing:-1.8px}.landing-page .hero-a .lead{font-size:15px;margin-top:19px;max-width:36ch}.landing-page .hero-actions{gap:17px;flex-wrap:wrap;margin-top:23px}.landing-page .free-note{font-size:10px}.landing-page .portfolio-body{min-height:0}.landing-page .portfolio-main{padding:16px 13px}.landing-page .window-header{padding:0 13px;height:42px}.landing-page .window-title{margin-bottom:14px}.landing-page .window-title h3{font-size:18px}.landing-page .data-table td{padding:11px 3px}.landing-page .data-table .registrar-col{display:none}.landing-page .registrar-mobile{display:block;color:#4d6354;font-size:11px;font-weight:400;letter-spacing:0}.landing-page .brand-strip{padding:22px 0}.landing-page .brand-list{gap:15px 22px}.landing-page .brand-list span{font-size:13px}.landing-page .brand-list .count{font-size:10px}.landing-page .inquiry-section{padding:43px 0;gap:27px}.landing-page h2{font-size:31px;letter-spacing:-1px}.landing-page .section-copy .lead{font-size:14px;max-width:38ch}.landing-page .inquiry-product{grid-template-columns:1fr}.landing-page .domain-landing{padding:24px}.landing-page .domain-landing h3{margin-top:22px;font-size:37px}.landing-page .domain-landing p{font-size:12px;max-width:32ch}.landing-page .public-domain-caption{margin-top:22px}.landing-page .domain-landing button{font-size:12px;min-height:43px}.landing-page .inquiry-owner{padding:23px}.landing-page .inquiry-owner-header{font-size:13px}.landing-page .inquiry-message{font-size:12px}.landing-page .inquiry-domain{font-size:11px}.landing-page .inquiry-status{font-size:11px}.landing-page .inquiry-bottom{margin-top:20px}.landing-page .product-caption{font-size:9px;flex-wrap:wrap;gap:4px}.landing-page .simple-close{display:block;padding:35px 0}.landing-page .simple-close h2{font-size:27px}.landing-page .simple-close .btn{margin-top:22px}.landing-page .site-footer{align-items:flex-start;flex-direction:column;gap:16px}.landing-page .site-footer p{max-width:47ch;font-size:10px}.landing-page .sample-form label{font-size:11px}.landing-page .sample-form input,.landing-page .sample-form textarea{font-size:13px;min-height:42px}.landing-page .sample-form textarea{height:80px}.landing-page .sample-form button{min-height:42px;font-size:12px}}
@media(prefers-reduced-motion:reduce){.landing-page *{scroll-behavior:auto!important;transition:none!important}}

.landing-page .sample-form [data-close-inquiry]{border:0;background:transparent;color:var(--muted);padding:0;margin:8px 0 0;min-height:36px;font-size:11px;text-decoration:underline;text-underline-offset:3px}

.landing-page .nav-actions>a:not(.btn){display:inline-flex;align-items:center;min-height:44px}

/* Integrate the approved composition without leaking styles into account pages. */
.landing-page>main{max-width:none;margin:0;padding:0;overflow-wrap:normal}
.landing-page>header.site-nav{padding:0;border:0;flex-wrap:nowrap;max-width:1240px}
.landing-page>footer.site-footer{max-width:1240px;padding:32px 0 36px;border-top:1px solid var(--line)}
.landing-page>footer.site-footer .software-credit{font-size:11px;line-height:1.7;margin:0;max-width:720px}
.landing-page p{color:inherit;max-width:none}.landing-page [hidden]{display:none!important}
.landing-page .eyebrow{text-transform:none;letter-spacing:0}
.landing-page h1,.landing-page h2,.landing-page h3{margin-top:0}
.landing-page a:hover{text-decoration:none}.landing-page .text-link:hover{text-decoration:underline;text-underline-offset:4px}
.landing-page .window-title .inventory-title{font-size:20px;line-height:1.4;letter-spacing:-.8px;font-weight:600}

.landing-page .mini-search{margin:0 0 10px;font-weight:400;cursor:text}
.landing-page .mini-search input{border:0;background:transparent;padding:0;width:100%;margin:0;font-size:10px;min-height:22px;color:var(--ink);outline-offset:2px}
.landing-page .mini-search:focus-within{outline:2px solid var(--forest);outline-offset:2px}
.landing-page .mini-search input:focus-visible{outline:none}

.landing-page .access-detail{font-size:11px;line-height:1.6;color:var(--muted);margin-top:3px;max-width:40ch}

.landing-page .brand-list{list-style:none;margin:0;padding:0;justify-content:flex-start;gap:18px 24px}
.landing-page .brand-list li{display:flex;align-items:center;gap:7px}
.landing-page .brand-list img{width:20px;height:20px;object-fit:contain;filter:brightness(0);opacity:.7;flex:none}
.landing-page .brand-list span{font-size:13px;letter-spacing:-.3px}
.landing-page .registrar-note{font-size:10px;line-height:1.7;color:var(--muted);padding-top:12px}
.landing-page .sample-form{margin:0;padding:0;max-width:none}
.landing-page .sample-form label{font-weight:400;margin:8px 0 0;font-size:10px}
.landing-page .sample-form input,.landing-page .sample-form textarea{display:block;margin-top:2px;border:1px solid #dce5d9;border-radius:4px;padding:7px 8px;background:#fff;font-size:11px;line-height:1.5;color:var(--ink);width:100%;min-height:33px}
.landing-page .sample-form textarea{height:58px;resize:vertical}
.landing-page .sample-form .demo-disclosure{font-size:10px;line-height:1.6;color:var(--muted);margin-bottom:9px}
.landing-page .sample-form [data-close-inquiry]{border:0;background:transparent;color:var(--muted);padding:0;margin:8px 0 0;min-height:36px;font-size:11px;text-decoration:underline;text-underline-offset:3px}
.landing-page .empty-sample{font-size:11px;color:var(--muted);padding:18px 4px}
.landing-page .collection-link{margin:0 0 24px;font-size:11px;color:var(--muted)}
.landing-page button:focus-visible,.landing-page a:focus-visible,.landing-page input:focus-visible,.landing-page textarea:focus-visible,.landing-page summary:focus-visible{outline:3px solid var(--forest);outline-offset:4px}

@media(max-width:600px){.landing-page .mini-search{min-height:44px}.landing-page .mini-search input{font-size:16px;min-height:30px}.landing-page button,.landing-page .domain-landing button,.landing-page .sample-form button,.landing-page .sample-form [data-close-inquiry]{min-height:44px}.landing-page .sample-form input,.landing-page .sample-form textarea{font-size:16px;min-height:44px}.landing-page .sample-form textarea{height:80px}.landing-page .sample-form label{font-size:11px}.landing-page .brand-list{gap:14px 20px}.landing-page .brand-list span{font-size:12px}.landing-page .brand-list img{width:18px;height:18px}.landing-page .access-detail{font-size:10px}}
/* A column footer must not inherit the shared desktop 440px flex basis as height. */
@media(max-width:600px){.landing-page>footer.site-footer .software-credit{flex:none;max-width:100%}}
@media(pointer:coarse){.landing-page button,.landing-page .domain-landing button,.landing-page .sample-form button,.landing-page .sample-form [data-close-inquiry],.landing-page .site-footer a,.landing-page .nav-center a{min-height:44px}.landing-page .mini-search{min-height:44px}.landing-page .mini-search input{font-size:16px;min-height:30px}}
/* Section links, informed by Rare UI Rail TOC. */
.landing-page .nav-center {
  align-items:center;
  justify-content:center;
  gap:clamp(6px,1.25vw,18px);
}
.landing-page .nav-center a {
  position:relative;
  display:grid;
  place-items:center;
  min-height:44px;
  border-radius:7px;
  padding-inline:10px;
  color:var(--muted);
  font-weight:500;
  transition:background-color .18s ease,color .18s ease;
}
.landing-page .nav-center a:hover,.landing-page .nav-center a[aria-current] {
  background:#eaf1e5;
  color:var(--forest);
}
.landing-page .nav-center a[aria-current]::after {
  content:"";
  position:absolute;
  inset:auto 10px 6px;
  height:2px;
  border-radius:2px;
  background:currentColor;
}
.landing-page :is(#features,#renewals,#inquiries) {scroll-margin-block-start:24px}

@media(max-width:920px) {
  .landing-page>header.site-nav {
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    height:auto;
    padding-block:13px 0;
    gap:6px 12px;
  }
  .landing-page .nav-center {
    grid-column:1 / -1;
    grid-row:2;
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:4px;
    padding-block:4px;
    border-block:1px solid var(--line);
  }
  .landing-page .nav-center a {padding-inline:3px}
  .landing-page .nav-actions {justify-self:end}
}

.landing-page [data-sample-inbox-preview] {
  margin-top:10px;
  overflow-wrap:anywhere;
}
.landing-page [data-sample-message] {white-space:pre-wrap}

/* Inquiry feedback. The Toast reference stays beside its control in this example. */
.landing-page .sample-form .sample-feedback {
  color:var(--forest);
  font-size:12px;
  line-height:1.5;
}
.landing-page .sample-form .sample-feedback:not(:empty) {
  display:grid;
  grid-template-columns:12px minmax(0,1fr);
  align-items:start;
  gap:8px;
  margin-top:10px;
  padding:9px 10px;
  border:1px solid #c8d9c8;
  border-radius:7px;
  background:var(--mint);
  animation:inquiry-feedback-in .2s ease-out;
}
.landing-page .sample-feedback:not(:empty)::before {
  content:"";
  justify-self:center;
  width:6px;
  height:10px;
  margin-top:2px;
  border:solid currentColor;
  border-width:0 2px 2px 0;
  transform:rotate(45deg);
}
@keyframes inquiry-feedback-in {
  from {opacity:0;transform:translateY(3px)}
  to {opacity:1;transform:none}
}
@media(prefers-reduced-motion:reduce) {
  .landing-page .sample-form .sample-feedback:not(:empty) {animation:none}
}

/* MCP example. Interaction references: Rare UI Gooey nav, Inline AI Status and Code Block. */
.landing-page .stage {
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(0,414px);
  grid-template-areas:"portfolio portfolio" "disclosure assistant";
  align-items:start;
  gap:16px 24px;
  min-width:0;
}
.landing-page .portfolio-window {grid-area:portfolio}
.landing-page .sample-disclosure {
  grid-area:disclosure;
  align-self:end;
  padding:0 0 4px 4px;
  color:var(--muted);
  font-size:11px;
  line-height:1.6;
  max-width:27ch;
}
.landing-page .sample-disclosure strong {
  display:block;
  margin-bottom:4px;
  color:var(--forest);
  font-weight:600;
}
.landing-page .assistant-panel {
  grid-area:assistant;
  min-width:0;
  padding:16px 18px;
  border:1px solid #345d46;
  border-radius:14px;
  background:#1f4431;
  color:#f0f6ec;
  box-shadow:0 16px 32px -21px #183c2c80;
  scroll-margin-block-start:20px;
}
.landing-page .agent-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}
.landing-page .agent-identity {
  display:flex;
  align-items:center;
  gap:8px;
  font-size:13px;
  font-weight:600;
  letter-spacing:0;
}
.landing-page .agent-identity svg {width:14px;height:14px;flex:none;color:#d9e8c7}
.landing-page .agent-header .sample {background:#31523d;border-color:#55735e;color:#dcead6}
.landing-page .agent-tabs {
  position:relative;
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  padding:3px;
  border:1px solid #53705d;
  border-radius:9px;
  background:#173727;
  margin-bottom:14px;
}
.landing-page .agent-tabs button {
  position:relative;
  min-height:34px;
  padding:4px 3px;
  border:0;
  border-radius:6px;
  background:transparent;
  color:#d8e7d1;
  font-size:11px;
  font-weight:600;
  line-height:1.2;
  text-align:center;
  transition:color .18s ease;
}
.landing-page .agent-tabs button:hover {color:#f3f8ed}
.landing-page .agent-tabs button[aria-pressed="true"] {background:#d9e8c7;color:#1b3828}
@supports selector(:has(*)) {
  .landing-page .agent-tabs::before {
    content:"";
    position:absolute;
    inset:3px auto 3px 3px;
    width:calc((100% - 6px) / 3);
    border-radius:6px;
    background:#d9e8c7;
    transform:translateX(var(--agent-offset,0%));
    transition:transform .24s cubic-bezier(.2,.8,.2,1);
    pointer-events:none;
  }
  .landing-page .agent-tabs:has([data-agent="budget"][aria-pressed="true"]) {--agent-offset:100%}
  .landing-page .agent-tabs:has([data-agent="dns"][aria-pressed="true"]) {--agent-offset:200%}
  .landing-page .agent-tabs button[aria-pressed="true"] {background:transparent}
}
.landing-page .agent-prompt {
  margin:0 0 12px;
  font-size:16px;
  font-weight:600;
  line-height:1.4;
  letter-spacing:-.2px;
}
.landing-page .agent-result {
  padding:9px 11px;
  border:1px solid #53705d;
  border-radius:8px;
  background:#274d38;
  color:#dcead6;
  font-size:12px;
  line-height:1.45;
}
.landing-page .agent-response-label {
  display:flex;
  align-items:center;
  gap:6px;
  margin-bottom:4px;
  color:#c5dbb8;
  font-size:10px;
  font-weight:600;
}
.landing-page .agent-response-label svg {width:13px;height:13px;flex:none}
.landing-page .agent-result strong {color:#f2f7ed;font-weight:600}
.landing-page .agent-result p {margin:3px 0 0}
.landing-page .agent-tool {margin-top:8px}
.landing-page .agent-tool summary {
  display:grid;
  grid-template-columns:15px minmax(0,1fr) 15px;
  align-items:center;
  gap:8px;
  min-height:34px;
  padding:4px 6px;
  border-radius:6px;
  color:#dcead6;
}
.landing-page .agent-tool summary::-webkit-details-marker {display:none}
.landing-page .agent-tool summary:hover,.landing-page .agent-tool[open] summary {background:#173727}
.landing-page .agent-tool summary svg {width:15px;height:15px}
.landing-page .agent-tool-caption {margin-right:8px;font-size:11px;font-weight:600}
.landing-page .agent-tool code {font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}
.landing-page .agent-tool-chevron {transition:transform .18s ease}
.landing-page .agent-tool[open] .agent-tool-chevron {transform:rotate(180deg)}
.landing-page .agent-tool pre {
  margin:6px 0 0;
  padding:10px 12px;
  border:1px solid #53705d;
  border-radius:6px;
  background:#173727;
  color:#dcead6;
  white-space:pre-wrap;
  overflow-wrap:anywhere;
}
.landing-page .assistant-panel:focus-visible,.landing-page .assistant-panel :focus-visible {
  outline:2px solid #d9e8c7;
  outline-offset:2px;
}
.landing-page .assistant-panel:focus-visible {outline-color:var(--forest)}
.landing-page .agent-tabs button[aria-pressed="true"]:focus-visible {outline-color:#1b3828;outline-offset:-3px}
@media(max-width:1050px) {
  .landing-page .stage {
    grid-template-columns:minmax(0,1fr);
    grid-template-areas:"portfolio" "assistant" "disclosure";
    gap:12px;
  }
  .landing-page .sample-disclosure {padding:0;max-width:54ch}
  .landing-page .sample-disclosure strong {display:inline;margin-right:2px}
}
@media(max-width:800px) {
  .landing-page .stage {width:100%;max-width:690px;margin-inline:auto}
}
@media(max-width:600px) {
  .landing-page .stage {grid-template-areas:"assistant" "disclosure" "portfolio"}
  .landing-page .assistant-panel {box-shadow:none;padding-inline:14px}
}
@media(max-width:600px),(pointer:coarse) {
  .landing-page .agent-tabs button,.landing-page .agent-tool summary {min-height:44px}
}
@media(prefers-reduced-motion:reduce) {
  .landing-page .agent-tabs::before {transition:none}
}

`;
