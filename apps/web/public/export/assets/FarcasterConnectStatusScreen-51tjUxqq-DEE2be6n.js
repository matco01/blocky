import{dK as X,dc as Y,dd as Z,di as ee,de as l,dl as u,dS as re,dG as F,dg as t,dI as O,dD as te,dh as s}from"./index-BPER27xv.js";import{n as ae}from"./OpenLink-CUpJ1mOr-BsggOxna.js";import{x as oe}from"./QrCode-DbnZwlkH-DSojiJOW.js";import{f as ie}from"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import{r as se}from"./LabelXs-oqZNqbm_-D2CJinay.js";import{a as ne}from"./shouldProceedtoEmbeddedWalletCreationFlow-B3vyavrh-DPwp1gfv.js";import{n as le}from"./ScreenLayout-OwaQQcxH-CcVZ4wK5.js";import{l as R}from"./farcaster-DPlSjvF5-B8Kbiugf.js";import{C as ce}from"./check-B73ttc72.js";import{C as de}from"./copy-CgUgB352.js";import"./dijkstra-COg3n3zL.js";import"./Screen-D30meWsY-BlNgqNh2.js";import"./index-CWARkn2w-D3bGtN4n.js";import"./createLucideIcon-Dp411C20.js";let ue=s.div`
  width: 100%;
`,pe=s.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  height: 56px;
  background: ${r=>r.$disabled?"var(--privy-color-background-2)":"var(--privy-color-background)"};
  border: 1px solid var(--privy-color-foreground-4);
  border-radius: var(--privy-border-radius-md);

  &:hover {
    border-color: ${r=>r.$disabled?"var(--privy-color-foreground-4)":"var(--privy-color-foreground-3)"};
  }
`,me=s.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
`,K=s.span`
  display: block;
  font-size: 16px;
  line-height: 24px;
  color: ${r=>r.$disabled?"var(--privy-color-foreground-2)":"var(--privy-color-foreground)"};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Single-line truncation: as a flex item this would otherwise be floored at its
     min-content width, so min-width: 0 lets it shrink and the ellipsis land at the
     container edge. */
  min-width: 0;

  @media (min-width: 441px) {
    font-size: 14px;
    line-height: 20px;
  }
`,he=s(K)`
  color: var(--privy-color-foreground-3);
  font-style: italic;
`,fe=s(se)`
  margin-bottom: 0.5rem;
`,ge=s(ie)`
  && {
    gap: 0.375rem;
    font-size: 14px;
    flex-shrink: 0;
  }
`;const ve=({value:r,title:p,placeholder:c,className:a,showCopyButton:d=!0,truncate:i,maxLength:m=40,disabled:h=!1})=>{let[n,x]=l.useState(!1),w=i&&r?((o,E,f)=>{if((o=o.startsWith("https://")?o.slice(8):o).length<=f)return o;if(E==="middle"){let y=Math.ceil(f/2)-2,C=Math.floor(f/2)-1;return`${o.slice(0,y)}...${o.slice(-C)}`}return`${o.slice(0,f-3)}...`})(r,i,m):r;return l.useEffect((()=>{if(n){let o=setTimeout((()=>x(!1)),3e3);return()=>clearTimeout(o)}}),[n]),t.jsxs(ue,{className:a,children:[p&&t.jsx(fe,{children:p}),t.jsxs(pe,{$disabled:h,children:[t.jsx(me,{children:r?t.jsx(K,{$disabled:h,title:r,children:w}):t.jsx(he,{$disabled:h,children:c||"No value"})}),d&&r&&t.jsx(ge,{onClick:function(o){o.stopPropagation(),navigator.clipboard.writeText(r).then((()=>x(!0))).catch(console.error)},size:"sm",children:t.jsxs(t.Fragment,n?{children:["Copied",t.jsx(ce,{size:14})]}:{children:["Copy",t.jsx(de,{size:14})]})})]})]})},xe=({connectUri:r,loading:p,success:c,errorMessage:a,onBack:d,onClose:i,onOpenFarcaster:m})=>t.jsx(le,O.isMobile||p?O.isIOS?{title:a?a.message:"Sign in with Farcaster",subtitle:a?a.detail:"To sign in with Farcaster, please open the Farcaster app.",icon:R,iconVariant:"loading",iconLoadingStatus:{success:c,fail:!!a},primaryCta:r&&m?{label:"Open Farcaster app",onClick:m}:void 0,onBack:d,onClose:i,watermark:!0}:{title:a?a.message:"Signing in with Farcaster",subtitle:a?a.detail:"This should only take a moment",icon:R,iconVariant:"loading",iconLoadingStatus:{success:c,fail:!!a},onBack:d,onClose:i,watermark:!0,children:r&&O.isMobile&&t.jsx(ye,{children:t.jsx(ae,{text:"Take me to Farcaster",url:r,color:"#8a63d2"})})}:{title:"Sign in with Farcaster",subtitle:"Scan with your phone's camera to continue.",onBack:d,onClose:i,watermark:!0,children:t.jsxs(be,{children:[t.jsx(Se,{children:r?t.jsx(oe,{url:r,size:275,squareLogoElement:R}):t.jsx(Ce,{children:t.jsx(te,{})})}),t.jsxs(we,{children:[t.jsx(Ee,{children:"Or copy this link and paste it into a phone browser to open the Farcaster app."}),r&&t.jsx(ve,{value:r,truncate:"end",maxLength:30,showCopyButton:!0,disabled:!0})]})]})}),Me={component:()=>{let{authenticated:r,logout:p,ready:c,user:a}=X(),{lastScreen:d,navigate:i,navigateBack:m,setModalData:h}=Y(),n=Z(),{getAuthFlow:x,loginWithFarcaster:w,closePrivyModal:o,createAnalyticsEvent:E}=ee(),[f,y]=l.useState(void 0),[C,Q]=l.useState(!1),[b,G]=l.useState(!1),T=l.useRef([]),S=x(),j=S==null?void 0:S.meta.connectUri;return l.useEffect((()=>{let g=Date.now(),A=setInterval((async()=>{var $,_,I,L,N,U,D,M,B,W,z,q,V,P,H;let k=await S.pollForReady.execute(),J=Date.now()-g;if(k){clearInterval(A),Q(!0);try{await w(),G(!0)}catch(e){let v={retryable:!1,message:"Authentication failed"};if((e==null?void 0:e.privyErrorCode)===u.ALLOWLIST_REJECTED)return void i("AllowlistRejectionScreen");if((e==null?void 0:e.privyErrorCode)===u.USER_LIMIT_REACHED)return console.error(new re(e).toString()),void i("UserLimitReachedScreen");if((e==null?void 0:e.privyErrorCode)===u.USER_DOES_NOT_EXIST)return void i("AccountNotFoundScreen");if((e==null?void 0:e.privyErrorCode)===u.LINKED_TO_ANOTHER_USER)v.detail=e.message??"This account has already been linked to another user.";else{if((e==null?void 0:e.privyErrorCode)===u.ACCOUNT_TRANSFER_REQUIRED&&((_=($=e.data)==null?void 0:$.data)!=null&&_.nonce))return h({accountTransfer:{nonce:(L=(I=e.data)==null?void 0:I.data)==null?void 0:L.nonce,account:(U=(N=e.data)==null?void 0:N.data)==null?void 0:U.subject,displayName:(B=(M=(D=e.data)==null?void 0:D.data)==null?void 0:M.account)==null?void 0:B.displayName,linkMethod:"farcaster",embeddedWalletAddress:(q=(z=(W=e.data)==null?void 0:W.data)==null?void 0:z.otherUser)==null?void 0:q.embeddedWalletAddress,farcasterEmbeddedAddress:(H=(P=(V=e.data)==null?void 0:V.data)==null?void 0:P.otherUser)==null?void 0:H.farcasterEmbeddedAddress}}),void i("LinkConflictScreen");(e==null?void 0:e.privyErrorCode)===u.INVALID_CREDENTIALS?(v.retryable=!0,v.detail="Something went wrong. Try again."):(e==null?void 0:e.privyErrorCode)===u.TOO_MANY_REQUESTS&&(v.detail="Too many requests. Please wait before trying again.")}y(v)}}else J>12e4&&(clearInterval(A),y({retryable:!0,message:"Authentication failed",detail:"The request timed out. Try again."}))}),2e3);return()=>{clearInterval(A),T.current.forEach((k=>clearTimeout(k)))}}),[]),l.useEffect((()=>{if(c&&r&&b&&a){if(n!=null&&n.legal.requireUsersAcceptTerms&&!a.hasAcceptedTerms){let g=setTimeout((()=>{i("AffirmativeConsentScreen")}),F);return()=>clearTimeout(g)}b&&(ne(a,n.embeddedWallets)?T.current.push(setTimeout((()=>{h({createWallet:{onSuccess:()=>{},onFailure:g=>{console.error(g),E({eventName:"embedded_wallet_creation_failure_logout",payload:{error:g,screen:"FarcasterConnectStatusScreen"}}),p()},callAuthOnSuccessOnClose:!0}}),i("EmbeddedWalletOnAccountCreateScreen")}),F)):T.current.push(setTimeout((()=>o({shouldCallAuthOnSuccess:!0,isSuccess:!0})),F)))}}),[b,c,r,a]),t.jsx(xe,{connectUri:j,loading:C,success:b,errorMessage:f,onBack:d?m:void 0,onClose:o,onOpenFarcaster:()=>{j&&(window.location.href=j)}})}};let ye=s.div`
  margin-top: 24px;
`,be=s.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`,Se=s.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 275px;
`,we=s.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`,Ee=s.div`
  font-size: 0.875rem;
  text-align: center;
  color: var(--privy-color-foreground-2);
`,Ce=s.div`
  position: relative;
  width: 82px;
  height: 82px;
`;export{Me as FarcasterConnectStatusScreen,xe as FarcasterConnectStatusView,Me as default};
