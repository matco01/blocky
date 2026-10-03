import{db as b,dc as k,dd as L,de as s,df as F,dg as e,dh as p}from"./index-BPER27xv.js";import{n as G}from"./index-CWARkn2w-D3bGtN4n.js";import{h as O,t as _}from"./GooglePay-B53WnudL-D-tDfX4t.js";import{a as w,o as R,p as Y}from"./isPaymentRequestAvailable-Bq1cemEn-DdHmAMlP.js";import{n as D}from"./styles-DVyDvTdj-29B0k9SC.js";import{i as P,l,s as a}from"./styles-hslXy6xG-Bq2dR7tg.js";import{C as T,L as S}from"./landmark-7yRESR-k.js";import{W as B}from"./wallet-B8ci_tnb.js";import"./ScreenLayout-OwaQQcxH-CcVZ4wK5.js";import"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import"./Screen-D30meWsY-BlNgqNh2.js";import"./createLucideIcon-Dp411C20.js";const X={component:()=>{let r=b(),{onUserCloseViaDialogOrKeybindRef:h}=k(),v=L(),i=s.useRef(!1),u=w(R),y=w(Y),[E,A]=s.useState(!1),m=u?"APPLE_PAY":u===!1&&y?"GOOGLE_PAY":null,f=u===!0||u===!1&&y!==void 0,j=!(r!=null&&r.startFiat)||f||E;s.useEffect((()=>{let t=window.setTimeout((()=>A(!0)),2e3);return()=>window.clearTimeout(t)}),[]),s.useEffect((()=>{r&&(i.current=!1)}),[r]);let C=s.useRef(null);s.useEffect((()=>{var t;r&&!r.error&&j&&C.current!==r&&(C.current=r,(t=r.recordRowsViewed)==null||t.call(r,{walletPay:r.startFiat?m:void 0,walletPayTimedOut:r.startFiat?!f:void 0}))}),[j,r,m,f]);let n=s.useCallback((async()=>{!i.current&&r&&(i.current=!0,F(),await r.onCancel())}),[r]);if(s.useEffect((()=>(h.current=n,()=>{h.current===n&&(h.current=null)})),[n,h]),!r)return null;if(r.error)return e.jsx(P,{title:"Unable to add funds",subtitle:r.error,showClose:!0,onClose:n,primaryCta:{label:"Close",onClick:n}});let x=async t=>{var g;i.current||(i.current=!0,await((g=r.startFiat)==null?void 0:g.call(r,t)))};return e.jsx(P,{title:"Pay with",subtitle:"Debit cards typically have higher success rates than credit cards, even with Apple Pay or Google Pay.",showClose:!0,onClose:n,children:j?e.jsxs(D,{style:{marginTop:"1rem"},$colorScheme:v.appearance.palette.colorScheme,children:[r.startFiat&&e.jsxs(l,{onClick:()=>x("CREDIT_DEBIT_CARD"),children:[e.jsx(o,{children:e.jsx(T,{})}),e.jsxs(c,{children:[e.jsx(a,{children:"Debit or credit card"}),e.jsx(d,{children:"Less than 10 minutes"})]})]}),r.startFiat&&m==="APPLE_PAY"&&e.jsxs(l,{onClick:()=>x("APPLE_PAY"),children:[e.jsx(o,{children:e.jsx(O,{width:18,height:18})}),e.jsxs(c,{children:[e.jsx(a,{children:"Apple Pay"}),e.jsx(d,{children:"Less than 10 minutes"})]})]}),r.startFiat&&m==="GOOGLE_PAY"&&e.jsxs(l,{onClick:()=>x("GOOGLE_PAY"),children:[e.jsx(o,{children:e.jsx(_,{width:18,height:18})}),e.jsxs(c,{children:[e.jsx(a,{children:"Google Pay"}),e.jsx(d,{children:"Less than 10 minutes"})]})]}),r.startFiat&&e.jsxs(l,{onClick:()=>x("BANK"),children:[e.jsx(o,{children:e.jsx(S,{})}),e.jsxs(c,{children:[e.jsx(a,{children:"Bank account"}),e.jsx(d,{children:"1–2 days"})]})]}),r.startCrypto&&e.jsxs(l,{onClick:async()=>{var t;i.current||(i.current=!0,await((t=r.startCrypto)==null?void 0:t.call(r)))},children:[e.jsx(o,{children:e.jsx(B,{})}),e.jsxs(c,{children:[e.jsx(a,{children:"Crypto wallet or exchange"}),e.jsx(d,{children:"Instant"})]})]})]}):e.jsx(I,{children:e.jsx(G,{size:"50px"})})})}};let I=p.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 1rem;
  min-height: 8rem;
`,o=p.span`
  width: 2rem;
  height: 2rem;
  border-radius: var(--privy-border-radius-full);
  background-color: var(--privy-color-background-2);
  color: var(--privy-color-icon-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;

  svg {
    width: 1.125rem;
    height: 1.125rem;
  }
`,c=p.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`,d=p.span`
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--privy-color-foreground-3);
`;export{X as AddFundsSelectionScreen,X as default};
