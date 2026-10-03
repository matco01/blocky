import{de as a,dK as R,di as _,dc as E,dg as e,eS as I,eT as F,eg as U,dh as p,ep as W}from"./index-BPER27xv.js";import{F as N}from"./ShieldCheckIcon-BIZvHZDO.js";import{b as O}from"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import{l as V}from"./Layouts-BMRfo5hw-rvTgYBPw.js";import{g as B,h as H,y as z,w as K,k as D}from"./shared-DRZUmnL5-De_TN9Af.js";import{w as s}from"./Screen-D30meWsY-BlNgqNh2.js";import"./index-CWARkn2w-D3bGtN4n.js";const re={component:()=>{let[o,y]=a.useState(!0),{authenticated:m,user:j}=R(),{walletProxy:i,closePrivyModal:v,createAnalyticsEvent:x,client:b}=_(),{navigate:k,data:C,onUserCloseViaDialogOrKeybindRef:S}=E(),[n,A]=a.useState(void 0),[f,d]=a.useState(""),[c,w]=a.useState(!1),{entropyId:u,entropyIdVerifier:T,onCompleteNavigateTo:g,onSuccess:h,onFailure:$}=C.recoverWallet,l=(r="User exited before their wallet could be recovered")=>{v({shouldCallAuthOnSuccess:!1}),$(typeof r=="string"?new U(r):r)};return S.current=l,a.useEffect((()=>{if(!m)return l("User must be authenticated and have a Privy wallet before it can be recovered")}),[m]),e.jsxs(s,{children:[e.jsx(s.Header,{icon:N,title:"Enter your password",subtitle:"Please provision your account on this new device. To continue, enter your recovery password.",showClose:!0,onClose:l}),e.jsx(s.Body,{children:e.jsx(Y,{children:e.jsxs("div",{children:[e.jsxs(B,{children:[e.jsx(H,{type:o?"password":"text",onChange:r=>(t=>{t&&A(t)})(r.target.value),disabled:c,style:{paddingRight:"2.3rem"}}),e.jsx(z,{style:{right:"0.75rem"},children:o?e.jsx(K,{onClick:()=>y(!1)}):e.jsx(D,{onClick:()=>y(!0)})})]}),!!f&&e.jsx(q,{children:f})]})})}),e.jsxs(s.Footer,{children:[e.jsx(s.HelpText,{children:e.jsxs(V,{children:[e.jsx("h4",{children:"Why is this necessary?"}),e.jsx("p",{children:"You previously set a password for this wallet. This helps ensure only you can access it"})]})}),e.jsx(s.Actions,{children:e.jsx(G,{loading:c||!i,disabled:!n,onClick:async()=>{w(!0);let r=await b.getAccessToken(),t=I(j,u);if(!r||!t||n===null)return l("User must be authenticated and have a Privy wallet before it can be recovered");try{x({eventName:"embedded_wallet_recovery_started",payload:{walletAddress:t.address}}),await(i==null?void 0:i.recover({accessToken:r,entropyId:u,entropyIdVerifier:T,recoveryPassword:n})),d(""),g?k(g):v({shouldCallAuthOnSuccess:!1}),h==null||h(t),x({eventName:"embedded_wallet_recovery_completed",payload:{walletAddress:t.address}})}catch(P){F(P)?d("Invalid recovery password, please try again."):d("An error has occurred, please try again.")}finally{w(!1)}},$hideAnimations:!u&&c,children:"Recover your account"})}),e.jsx(s.Watermark,{})]})]})}};let Y=p.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`,q=p.div`
  line-height: 20px;
  height: 20px;
  font-size: 13px;
  color: var(--privy-color-error);
  text-align: left;
  margin-top: 0.5rem;
`,G=p(O)`
  ${({$hideAnimations:o})=>o&&W`
      && {
        /* Remove animations because the recoverWallet task on the iframe partially
           blocks the renderer, so the animation stutters and doesn't look good */
        transition: none;
      }
    `}
`;export{re as PasswordRecoveryScreen,re as default};
