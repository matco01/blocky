import{de as s,dc as re,dd as G,di as oe,dK as ae,dG as Q,dg as r,dV as E,dl as b,dS as te,dI as ne,dh as w}from"./index-BPER27xv.js";import{F as ie}from"./EnvelopeIcon-DLmBjpgG.js";import{F as se}from"./PhoneIcon-CZVErVI6.js";import{o as le}from"./Layouts-BMRfo5hw-rvTgYBPw.js";import{i as ce}from"./Link-BdDilT2T-CtukHMiW.js";import{a as de}from"./shouldProceedtoEmbeddedWalletCreationFlow-B3vyavrh-DPwp1gfv.js";import{n as ue}from"./ScreenLayout-OwaQQcxH-CcVZ4wK5.js";import"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import"./Screen-D30meWsY-BlNgqNh2.js";import"./index-CWARkn2w-D3bGtN4n.js";function pe({title:o,titleId:p,...A},m){return s.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 20 20",fill:"currentColor","aria-hidden":"true","data-slot":"icon",ref:m,"aria-labelledby":p},A),o?s.createElement("title",{id:p},o):null,s.createElement("path",{fillRule:"evenodd",d:"M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z",clipRule:"evenodd"}))}const me=s.forwardRef(pe),fe=({contactMethod:o,authFlow:p,emailDomain:A,appName:m="Privy",whatsAppEnabled:j=!1,onBack:l,onCodeSubmit:T,onResend:M,errorMessage:f,success:g=!1,resendCountdown:D=0,onInvalidInput:N,onClearError:v})=>{let[d,_]=s.useState(J);s.useEffect((()=>{f||_(J)}),[f]);let S=async y=>{var x;y.preventDefault();let n=y.currentTarget.value.replace(" ","");if(n==="")return;if(isNaN(Number(n)))return void(N==null?void 0:N("Code should be numeric"));v==null||v();let h=Number((x=y.currentTarget.name)==null?void 0:x.charAt(5)),c=[...n||[""]].slice(0,Z-h),t=[...d.slice(0,h),...c,...d.slice(h+c.length)];_(t);let C=Math.min(Math.max(h+c.length,0),Z-1);if(!isNaN(Number(y.currentTarget.value))){let a=document.querySelector(`input[name=code-${C}]`);a==null||a.focus()}if(t.every((a=>a&&!isNaN(+a)))){let a=document.querySelector(`input[name=code-${C}]`);a==null||a.blur(),await(T==null?void 0:T(t.join("")))}};return r.jsx(ue,{title:"Enter confirmation code",subtitle:r.jsxs("span",p==="email"?{children:["Please check ",r.jsx(ee,{children:o})," for an email from"," ",A??"privy.io"," and enter your code below."]}:{children:["Please check ",r.jsx(ee,{children:o})," for a",j?" WhatsApp":""," message from ",m," and enter your code below."]}),icon:p==="email"?ie:se,onBack:l,showBack:!0,helpText:r.jsxs(Ee,{children:[r.jsxs("span",{children:["Didn't get ",p==="email"?"an email":"a message","?"]}),D?r.jsxs(be,{children:[r.jsx(me,{color:"var(--privy-color-foreground)",strokeWidth:1.33,height:"12px",width:"12px"}),r.jsx("span",{children:"Code sent"})]}):r.jsx(ce,{as:"button",size:"sm",onClick:M,children:"Resend code"})]}),children:r.jsx(xe,{children:r.jsx(le,{children:r.jsxs(ge,{children:[r.jsx("div",{children:d.map(((y,n)=>r.jsx("input",{name:`code-${n}`,type:"text",value:d[n],onChange:S,onKeyUp:h=>{h.key==="Backspace"&&(c=>{if(v==null||v(),_([...d.slice(0,c),"",...d.slice(c+1)]),c>0){let t=document.querySelector(`input[name=code-${c-1}]`);t==null||t.focus()}})(n)},inputMode:"numeric",autoFocus:n===0,pattern:"[0-9]",className:`${g?"success":""} ${f?"fail":""}`,autoComplete:ne.isMobile?"one-time-code":"off"},n)))}),r.jsx(ye,{$fail:!!f,$success:g,children:r.jsx("span",{children:f==="Invalid or expired verification code"?"Incorrect code":f||(g?"Success!":"")})})]})})})})};let Z=6,J=Array(6).fill("");var R,k,ve=((R=ve||{})[R.RESET_AFTER_DELAY=0]="RESET_AFTER_DELAY",R[R.CLEAR_ON_NEXT_VALID_INPUT=1]="CLEAR_ON_NEXT_VALID_INPUT",R),he=((k=he||{})[k.EMAIL=0]="EMAIL",k[k.SMS=1]="SMS",k);const je={component:()=>{var F,U,P;let{navigate:o,lastScreen:p,navigateBack:A,setModalData:m,onUserCloseViaDialogOrKeybindRef:j}=re(),l=G(),{closePrivyModal:T,resendEmailCode:M,resendSmsCode:f,getAuthMeta:g,loginWithCode:D,updateWallets:N,createAnalyticsEvent:v}=oe(),{authenticated:d,logout:_,user:S}=ae(),{whatsAppEnabled:y}=G(),[n,h]=s.useState(!1),[c,t]=s.useState(null),[C,x]=s.useState(null),[a,L]=s.useState(0);j.current=()=>null;let I=(F=g())!=null&&F.email?0:1,O=I===0?((U=g())==null?void 0:U.email)||"":((P=g())==null?void 0:P.phoneNumber)||"",$=Q-500;return s.useEffect((()=>{if(a){let i=setTimeout((()=>{L(a-1)}),1e3);return()=>clearTimeout(i)}}),[a]),s.useEffect((()=>{if(d&&n&&S){if(l!=null&&l.legal.requireUsersAcceptTerms&&!S.hasAcceptedTerms){let i=setTimeout((()=>{o("AffirmativeConsentScreen")}),$);return()=>clearTimeout(i)}if(de(S,l.embeddedWallets)){let i=setTimeout((()=>{m({createWallet:{onSuccess:()=>{},onFailure:u=>{console.error(u),v({eventName:"embedded_wallet_creation_failure_logout",payload:{error:u,screen:"AwaitingPasswordlessCodeScreen"}}),_()},callAuthOnSuccessOnClose:!0}}),o("EmbeddedWalletOnAccountCreateScreen")}),$);return()=>clearTimeout(i)}{N();let i=setTimeout((()=>T({shouldCallAuthOnSuccess:!0,isSuccess:!0})),Q);return()=>clearTimeout(i)}}}),[d,n,S]),s.useEffect((()=>{if(c&&C===0){let i=setTimeout((()=>{t(null),x(null);let u=document.querySelector("input[name=code-0]");u==null||u.focus()}),1400);return()=>clearTimeout(i)}}),[c,C]),r.jsx(fe,{contactMethod:O,authFlow:I===0?"email":"sms",emailDomain:l==null?void 0:l.appearance.emailDomain,appName:l==null?void 0:l.name,whatsAppEnabled:y,onBack:()=>A(),onCodeSubmit:async i=>{var u,W,B,V,q,K,z,X,Y,H;try{await D(i),h(!0)}catch(e){if(e instanceof E&&e.privyErrorCode===b.INVALID_CREDENTIALS)t("Invalid or expired verification code"),x(0);else if(e instanceof E&&e.privyErrorCode===b.CANNOT_LINK_MORE_OF_TYPE)t(e.message);else{if(e instanceof E&&e.privyErrorCode===b.USER_LIMIT_REACHED)return console.error(new te(e).toString()),void o("UserLimitReachedScreen");if(e instanceof E&&e.privyErrorCode===b.USER_DOES_NOT_EXIST)return void o("AccountNotFoundScreen");if(e instanceof E&&e.privyErrorCode===b.LINKED_TO_ANOTHER_USER)return m({errorModalData:{error:e,previousScreen:p??"AwaitingPasswordlessCodeScreen"}}),void o("ErrorScreen",!1);if(e instanceof E&&e.privyErrorCode===b.DISALLOWED_PLUS_EMAIL)return m({inlineError:{error:e}}),void o("ConnectOrCreateScreen",!1);if(e instanceof E&&e.privyErrorCode===b.ACCOUNT_TRANSFER_REQUIRED&&((W=(u=e.data)==null?void 0:u.data)!=null&&W.nonce))return m({accountTransfer:{nonce:(V=(B=e.data)==null?void 0:B.data)==null?void 0:V.nonce,account:O,displayName:(z=(K=(q=e.data)==null?void 0:q.data)==null?void 0:K.account)==null?void 0:z.displayName,linkMethod:I===0?"email":"sms",embeddedWalletAddress:(H=(Y=(X=e.data)==null?void 0:X.data)==null?void 0:Y.otherUser)==null?void 0:H.embeddedWalletAddress}}),void o("LinkConflictScreen");t("Issue verifying code"),x(0)}}},onResend:async()=>{L(30),I===0?await M():await f()},errorMessage:c||void 0,success:n,resendCountdown:a,onInvalidInput:i=>{t(i),x(1)},onClearError:()=>{C===1&&(t(null),x(null))}})}};let xe=w.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: auto;
  gap: 16px;
  flex-grow: 1;
  width: 100%;
`,ge=w.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 12px;

  > div:first-child {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    border-radius: var(--privy-border-radius-sm);

    > input {
      border: 1px solid var(--privy-color-foreground-4);
      background: var(--privy-color-background);
      border-radius: var(--privy-border-radius-sm);
      padding: 8px 10px;
      height: 48px;
      width: 40px;
      text-align: center;
      font-size: 18px;
      font-weight: 600;
      color: var(--privy-color-foreground);
      transition: all 0.2s ease;
    }

    > input:focus {
      border: 1px solid var(--privy-color-foreground);
      box-shadow: 0 0 0 1px var(--privy-color-foreground);
    }

    > input:invalid {
      border: 1px solid var(--privy-color-error);
    }

    > input.success {
      border: 1px solid var(--privy-color-border-success);
      background: var(--privy-color-success-bg);
    }

    > input.fail {
      border: 1px solid var(--privy-color-border-error);
      background: var(--privy-color-error-bg);
      animation: shake 180ms;
      animation-iteration-count: 2;
    }
  }

  @keyframes shake {
    0% {
      transform: translate(1px, 0);
    }
    33% {
      transform: translate(-1px, 0);
    }
    67% {
      transform: translate(-1px, 0);
    }
    100% {
      transform: translate(1px, 0);
    }
  }
`,ye=w.div`
  line-height: 20px;
  min-height: 20px;
  font-size: 14px;
  font-weight: 400;
  color: ${o=>o.$success?"var(--privy-color-success-dark)":o.$fail?"var(--privy-color-error-dark)":"transparent"};
  display: flex;
  justify-content: center;
  width: 100%;
  text-align: center;
`,Ee=w.div`
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: var(--privy-color-foreground-2);
`,be=w.div`
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--privy-border-radius-sm);
  padding: 2px 8px;
  gap: 4px;
  background: var(--privy-color-background-2);
  color: var(--privy-color-foreground-2);
`,ee=w.span`
  font-weight: 500;
  word-break: break-all;
  color: var(--privy-color-foreground);
`;export{je as AwaitingPasswordlessCodeScreen,fe as AwaitingPasswordlessCodeScreenView,je as default};
