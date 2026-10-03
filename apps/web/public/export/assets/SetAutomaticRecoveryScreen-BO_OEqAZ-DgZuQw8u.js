import{dK as k,di as I,dc as P,de as u,dg as e,eD as v,eS as j,dG as W,dh as A}from"./index-BPER27xv.js";import{F as M}from"./ExclamationTriangleIcon-yopneUXt.js";import{F as V}from"./LockClosedIcon-D-WTDdwc.js";import{L as S,u as b,h as C}from"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import{r as B}from"./Subtitle-CV-2yKE4-DwVg2r_9.js";import{e as T}from"./Title-BnzYV3Is-N7jcPdXc.js";const D=A.div`
  && {
    border-width: 4px;
  }

  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  aspect-ratio: 1;
  border-style: solid;
  border-color: ${i=>i.$color??"var(--privy-color-accent)"};
  border-radius: 50%;
`,q={component:()=>{var g;let{user:i}=k(),{client:E,walletProxy:m,refreshSessionAndUser:F,closePrivyModal:l}=I(),s=P(),{entropyId:f,entropyIdVerifier:R}=((g=s.data)==null?void 0:g.recoverWallet)??{},[n,h]=u.useState(!1),[c,U]=u.useState(null),[d,p]=u.useState(null);function y(){var r,o,t,a;if(!n){if(d)return(o=(r=s.data)==null?void 0:r.setWalletPassword)==null||o.onFailure(d),void l();if(!c)return(a=(t=s.data)==null?void 0:t.setWalletPassword)==null||a.onFailure(Error("User exited set recovery flow")),void l()}}s.onUserCloseViaDialogOrKeybindRef.current=y;let $=!(!n&&!c);return e.jsxs(e.Fragment,d?{children:[e.jsx(S,{onClose:y},"header"),e.jsx(D,{$color:"var(--privy-color-error)",style:{alignSelf:"center"},children:e.jsx(M,{height:38,width:38,stroke:"var(--privy-color-error)"})}),e.jsx(T,{style:{marginTop:"0.5rem"},children:"Something went wrong"}),e.jsx(v,{style:{minHeight:"2rem"}}),e.jsx(b,{onClick:()=>p(null),children:"Try again"}),e.jsx(C,{})]}:{children:[e.jsx(S,{onClose:y},"header"),e.jsx(V,{style:{width:"3rem",height:"3rem",alignSelf:"center"}}),e.jsx(T,{style:{marginTop:"0.5rem"},children:"Automatically secure your account"}),e.jsx(B,{style:{marginTop:"1rem"},children:"When you log into a new device, you’ll only need to authenticate to access your account. Never get logged out if you forget your password."}),e.jsx(v,{style:{minHeight:"2rem"}}),e.jsx(b,{loading:n,disabled:$,onClick:()=>(async function(){h(!0);try{let r=await E.getAccessToken(),o=j(i,f);if(!r||!m||!o)return;if(!(await m.setRecovery({accessToken:r,entropyId:f,entropyIdVerifier:R,existingRecoveryMethod:o.recoveryMethod,recoveryMethod:"privy"})).entropyId)throw Error("Unable to set recovery on wallet");let t=await F();if(!t)throw Error("Unable to set recovery on wallet");let a=j(t,o.address);if(!a)throw Error("Unabled to set recovery on wallet");U(!!t),setTimeout((()=>{var w,x;(x=(w=s.data)==null?void 0:w.setWalletPassword)==null||x.onSuccess(a),l()}),W)}catch(r){p(r)}finally{h(!1)}})(),children:c?"Success":"Confirm"}),e.jsx(C,{})]})}};export{q as SetAutomaticRecoveryScreen,q as default};
