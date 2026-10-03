import{de as f,dh as h,di as Be,dg as e,dd as xe,eN as ne,eD as he,gr as Ve,cn as He}from"./index-BPER27xv.js";import{L as X,i as Ue,b as Z,h as je,w as qe}from"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import{e as n,t as B,s,n as i,a as Je}from"./Value-DTgR824E-DZqziRYy.js";import{e as z}from"./ErrorMessage-D8VaAP5m-DNIqA-kj.js";import{r as O}from"./LabelXs-oqZNqbm_-D2CJinay.js";import{r as me}from"./Subtitle-CV-2yKE4-DwVg2r_9.js";import{e as ue}from"./Title-BnzYV3Is-N7jcPdXc.js";import{d as c}from"./Address-H8kD1d9O-Dma8J43K.js";import{j as Qe}from"./WalletInfoCard-sq_2wgFg-C9nw26M2.js";import{i as pe}from"./LoadingSkeleton-BMsgO5PV-JhWuD-zp.js";import{d as Xe}from"./shared-FM0rljBt-CdtIomqB.js";import{o as Ze,F as Ke}from"./Checkbox-D1EDeo41-DAO_D4Pc.js";import{i as Ye}from"./ErrorBanner-BcpGRt0h-D8kuVRIr.js";import{t as _e}from"./WarningBanner-ZZqCEtZK-CCPgabPQ.js";import{F as Ge}from"./ExclamationCircleIcon-D_nv5wQ_.js";import{F as ge}from"./ChevronDownIcon-DzoxyTK9.js";function We({title:l,titleId:a,...o},m){return f.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:m,"aria-labelledby":a},o),l?f.createElement("title",{id:a},l):null,f.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"}))}const $e=f.forwardRef(We);function er({title:l,titleId:a,...o},m){return f.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:m,"aria-labelledby":a},o),l?f.createElement("title",{id:a},l):null,f.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"}))}const fe=f.forwardRef(er);function rr({title:l,titleId:a,...o},m){return f.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:m,"aria-labelledby":a},o),l?f.createElement("title",{id:a},l):null,f.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z"}))}const sr=f.forwardRef(rr),ye=h(n)`
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: var(--privy-color-accent);
  svg {
    fill: var(--privy-color-accent);
  }
`;var ie=({iconUrl:l,value:a,symbol:o,usdValue:m,nftName:E,nftCount:p,decimals:t,$isLoading:y})=>{if(y)return e.jsx(te,{$isLoading:y});let k=a&&m&&t?(function(w,I,A){let b=parseFloat(w),x=parseFloat(A);if(b===0||x===0||Number.isNaN(b)||Number.isNaN(x))return w;let g=Math.ceil(-Math.log10(.01/(x/b))),d=Math.pow(10,g=Math.max(g=Math.min(g,I),1)),T=+(Math.floor(b*d)/d).toFixed(g).replace(/\.?0+$/,"");return Intl.NumberFormat(void 0,{maximumFractionDigits:I}).format(T)})(a,t,m):a;return e.jsxs("div",{children:[e.jsxs(te,{$isLoading:y,children:[l&&e.jsx(ir,{src:l,alt:"Token icon"}),p&&p>1?p+"x":void 0," ",E,k," ",o]}),m&&e.jsxs(nr,{$isLoading:y,children:["$",m]})]})};let te=h.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.375rem;
  word-break: break-all;
  text-align: right;
  display: flex;
  justify-content: flex-end;

  /**
   * @NOTE This is a code smell anti-pattern for styling components.
   * We are mixing JSX definitions with styled-components CSS definitions.
   * This is not ideal and should be refactored in the future to separate concerns.
   * This is also hard to read, as it makes it difficult to understand the structure
   * of the component and its styles by viewing the JSX.
   */

  ${pe}
`;const nr=h.span`
  color: var(--privy-color-foreground-2);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  word-break: break-all;
  text-align: right;
  display: flex;
  justify-content: flex-end;

  ${pe}
`;let ir=h.img`
  height: 14px;
  width: 14px;
  margin-right: 4px;
  object-fit: contain;
`;const tr=l=>{var y,k,w,I,A,b,x,g;let{chain:a,transactionDetails:o,isTokenContractInfoLoading:m,symbol:E}=l,{action:p,functionName:t}=o;return e.jsx(Xe,{children:e.jsxs(B,{children:[p!=="transaction"&&e.jsxs(s,{children:[e.jsx(n,{children:"Action"}),e.jsx(i,{children:t})]}),t==="mint"&&"args"in o&&o.args.filter((d=>d)).map(((d,T)=>{var u,S;return e.jsxs(s,{children:[e.jsx(n,{children:`Param ${T}`}),e.jsx(i,{children:typeof d=="string"&&He(d)?e.jsx(c,{address:d,url:(S=(u=a==null?void 0:a.blockExplorers)==null?void 0:u.default)==null?void 0:S.url,showCopyIcon:!1}):d==null?void 0:d.toString()})]},T)})),t==="setApprovalForAll"&&o.operator&&e.jsxs(s,{children:[e.jsx(n,{children:"Operator"}),e.jsx(i,{children:e.jsx(c,{address:o.operator,url:(k=(y=a==null?void 0:a.blockExplorers)==null?void 0:y.default)==null?void 0:k.url,showCopyIcon:!1})})]}),t==="setApprovalForAll"&&o.approved!==void 0&&e.jsxs(s,{children:[e.jsx(n,{children:"Set approval to"}),e.jsx(i,{children:o.approved?"true":"false"})]}),t==="transfer"||t==="transferWithMemo"||t==="transferFrom"||t==="safeTransferFrom"||t==="approve"?e.jsxs(e.Fragment,{children:["formattedAmount"in o&&o.formattedAmount&&e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsxs(i,{$isLoading:m,children:[o.formattedAmount," ",E]})]}),"tokenId"in o&&o.tokenId&&e.jsxs(s,{children:[e.jsx(n,{children:"Token ID"}),e.jsx(i,{children:o.tokenId.toString()})]})]}):null,t==="safeBatchTransferFrom"&&e.jsxs(e.Fragment,{children:["amounts"in o&&o.amounts&&e.jsxs(s,{children:[e.jsx(n,{children:"Amounts"}),e.jsx(i,{children:o.amounts.join(", ")})]}),"tokenIds"in o&&o.tokenIds&&e.jsxs(s,{children:[e.jsx(n,{children:"Token IDs"}),e.jsx(i,{children:o.tokenIds.join(", ")})]})]}),t==="approve"&&o.spender&&e.jsxs(s,{children:[e.jsx(n,{children:"Spender"}),e.jsx(i,{children:e.jsx(c,{address:o.spender,url:(I=(w=a==null?void 0:a.blockExplorers)==null?void 0:w.default)==null?void 0:I.url,showCopyIcon:!1})})]}),(t==="transferFrom"||t==="safeTransferFrom"||t==="safeBatchTransferFrom")&&o.transferFrom&&e.jsxs(s,{children:[e.jsx(n,{children:"Transferring from"}),e.jsx(i,{children:e.jsx(c,{address:o.transferFrom,url:(b=(A=a==null?void 0:a.blockExplorers)==null?void 0:A.default)==null?void 0:b.url,showCopyIcon:!1})})]}),(t==="transferFrom"||t==="safeTransferFrom"||t==="safeBatchTransferFrom")&&o.transferTo&&e.jsxs(s,{children:[e.jsx(n,{children:"Transferring to"}),e.jsx(i,{children:e.jsx(c,{address:o.transferTo,url:(g=(x=a==null?void 0:a.blockExplorers)==null?void 0:x.default)==null?void 0:g.url,showCopyIcon:!1})})]})]})})},or=({variant:l,setPreventMaliciousTransaction:a,colorScheme:o="light",preventMaliciousTransaction:m})=>l==="warn"?e.jsx(oe,{children:e.jsxs(_e,{theme:o,children:[e.jsx("span",{style:{fontWeight:"500"},children:"Warning: Suspicious transaction"}),e.jsx("br",{}),"This has been flagged as a potentially deceptive request. Approving could put your assets or funds at risk."]})}):l==="error"?e.jsx(e.Fragment,{children:e.jsxs(oe,{children:[e.jsx(Ye,{theme:o,children:e.jsxs("div",{children:[e.jsx("strong",{children:"This is a malicious transaction"}),e.jsx("br",{}),"This transaction transfers tokens to a known malicious address. Proceeding may result in the loss of valuable assets."]})}),e.jsxs(ar,{children:[e.jsx(Ze,{color:"var(--privy-color-error)",checked:!m,readOnly:!0,onClick:()=>a(!m)}),e.jsx("span",{children:"I understand and want to proceed anyways."})]})]})}):null;let oe=h.div`
  margin-top: 1.5rem;
`,ar=h.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
`;const lr=({transactionIndex:l,maxIndex:a})=>typeof l!="number"||a===0?"":` (${l+1} / ${a+1})`,Pr=({img:l,submitError:a,prepareError:o,onClose:m,action:E,title:p,subtitle:t,to:y,tokenAddress:k,network:w,missingFunds:I,fee:A,from:b,cta:x,disabled:g,chain:d,isSubmitting:T,isPreparing:u,isTokenPriceLoading:S,isTokenContractInfoLoading:N,isSponsored:D,symbol:V,balance:R,onClick:L,transactionDetails:C,transactionIndex:P,maxIndex:H,onBack:r,chainName:v,validation:U,hasScanDetails:K,setIsScanDetailsOpen:Ie,preventMaliciousTransaction:Ae,setPreventMaliciousTransaction:Se,tokensSent:Y,tokensReceived:q,isScanning:Ce,isCancellable:Fe,functionName:Ee})=>{var _,G,W,$,ee,re;let{showTransactionDetails:J,setShowTransactionDetails:Oe,hasMoreDetails:Ne,isErc20Ish:Le}=(j=>{let[M,Re]=f.useState(!1),Q=!0,se=!1;return(!j||j.isErc20Ish||j.action==="transaction")&&(Q=!1),Q&&(se=Object.entries(j||{}).some((([Pe,ze])=>ze&&!["action","isErc20Ish","isNFTIsh"].includes(Pe)))),{showTransactionDetails:M,setShowTransactionDetails:Re,hasMoreDetails:Q&&se,isErc20Ish:j==null?void 0:j.isErc20Ish}})(C),De=xe(),Me=Le&&N||u||S||Ce;return e.jsxs(e.Fragment,{children:[e.jsx(X,{onClose:m,backFn:r}),l&&e.jsx(we,{children:l}),e.jsxs(ue,{style:{marginTop:l?"1.5rem":0},children:[p,e.jsx(lr,{maxIndex:H,transactionIndex:P})]}),e.jsx(me,{children:t}),e.jsxs(B,{style:{marginTop:"2rem"},children:[(!!Y[0]||Me)&&e.jsxs(s,{children:[q.length>0?e.jsx(n,{children:"Send"}):e.jsx(n,{children:E==="approve"?"Approval amount":"Amount"}),e.jsx("div",{className:"flex flex-col",children:Y.map(((j,M)=>e.jsx(ie,{iconUrl:j.iconUrl,value:Ee==="setApprovalForAll"?"All":j.value,usdValue:j.usdValue,symbol:j.symbol,nftName:j.nftName,nftCount:j.nftCount,decimals:j.decimals},M)))})]}),q.length>0&&e.jsxs(s,{children:[e.jsx(n,{children:"Receive"}),e.jsx("div",{className:"flex flex-col",children:q.map(((j,M)=>e.jsx(ie,{iconUrl:j.iconUrl,value:j.value,usdValue:j.usdValue,symbol:j.symbol,nftName:j.nftName,nftCount:j.nftCount,decimals:j.decimals},M)))})]}),C&&"spender"in C&&(C!=null&&C.spender)?e.jsxs(s,{children:[e.jsx(n,{children:"Spender"}),e.jsx(i,{children:e.jsx(c,{address:C.spender,url:(G=(_=d==null?void 0:d.blockExplorers)==null?void 0:_.default)==null?void 0:G.url})})]}):null,y&&e.jsxs(s,{children:[e.jsx(n,{children:"To"}),e.jsx(i,{children:e.jsx(c,{address:y,url:($=(W=d==null?void 0:d.blockExplorers)==null?void 0:W.default)==null?void 0:$.url,showCopyIcon:!0})})]}),k&&e.jsxs(s,{children:[e.jsx(n,{children:"Token address"}),e.jsx(i,{children:e.jsx(c,{address:k,url:(re=(ee=d==null?void 0:d.blockExplorers)==null?void 0:ee.default)==null?void 0:re.url})})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Network"}),e.jsx(i,{children:w})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Estimated fee"}),e.jsx(i,{$isLoading:u||S||D===void 0,children:D?e.jsxs(be,{children:[e.jsxs(Te,{children:["Sponsored by ",De.name]}),e.jsx(fe,{height:16,width:16})]}):A})]}),Ne&&!K&&e.jsxs(e.Fragment,{children:[e.jsx(s,{className:"cursor-pointer",onClick:()=>Oe(!J),children:e.jsxs(Je,{className:"flex items-center gap-x-1",children:["Details"," ",e.jsx(ge,{style:{width:"0.75rem",marginLeft:"0.25rem",transform:J?"rotate(180deg)":void 0}})]})}),J&&C&&e.jsx(tr,{action:E,chain:d,transactionDetails:C,isTokenContractInfoLoading:N,symbol:V})]}),K&&e.jsx(s,{children:e.jsxs(ye,{onClick:()=>Ie(!0),children:[e.jsx("span",{className:"text-color-primary",children:"Details"}),e.jsx($e,{height:"14px",width:"14px",strokeWidth:"2"})]})})]}),e.jsx(he,{}),a?e.jsx(z,{style:{marginTop:"2rem"},children:a.message}):o&&P===0?e.jsx(z,{style:{marginTop:"2rem"},children:o.shortMessage??ve}):null,e.jsx(or,{variant:U,preventMaliciousTransaction:Ae,setPreventMaliciousTransaction:Se}),e.jsx(ke,{$useSmallMargins:!(!o&&!a&&U!=="warn"&&U!=="error"),address:b,balance:R,errMsg:u||o||a||!I?void 0:`Add funds on ${(d==null?void 0:d.name)??v} to complete transaction.`}),e.jsx(Z,{style:{marginTop:"1rem"},loading:T,disabled:g||u,onClick:L,children:x}),Fe&&e.jsx(qe,{style:{marginTop:"1rem"},onClick:m,isSubmitting:!1,children:"Not now"}),e.jsx(je,{})]})},zr=({img:l,title:a,subtitle:o,cta:m,instructions:E,network:p,blockExplorerUrl:t,isMissingFunds:y,submitError:k,parseError:w,total:I,swap:A,transactingWalletAddress:b,fee:x,balance:g,disabled:d,isSubmitting:T,isPreparing:u,isTokenPriceLoading:S,onClick:N,onClose:D,onBack:V,isSponsored:R})=>{let L=u||S,[C,P]=f.useState(!1),H=xe();return e.jsxs(e.Fragment,{children:[e.jsx(X,{onClose:D,backFn:V}),l&&e.jsx(we,{children:l}),e.jsx(ue,{style:{marginTop:l?"1.5rem":0},children:a}),e.jsx(me,{children:o}),e.jsxs(B,{style:{marginTop:"2rem",marginBottom:".5rem"},children:[(I||L)&&e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsx(i,{$isLoading:L,children:I})]}),A&&e.jsxs(s,{children:[e.jsx(n,{children:"Swap"}),e.jsx(i,{children:A})]}),p&&e.jsxs(s,{children:[e.jsx(n,{children:"Network"}),e.jsx(i,{children:p})]}),(x||L||R!==void 0)&&e.jsxs(s,{children:[e.jsx(n,{children:"Estimated fee"}),e.jsx(i,{$isLoading:L,children:R&&!L?e.jsxs(be,{children:[e.jsxs(Te,{children:["Sponsored by ",H.name]}),e.jsx(fe,{height:16,width:16})]}):x})]})]}),e.jsx(s,{children:e.jsxs(ye,{onClick:()=>P((r=>!r)),children:[e.jsx("span",{children:"Advanced"}),e.jsx(ge,{height:"16px",width:"16px",strokeWidth:"2",style:{transition:"all 300ms",transform:C?"rotate(180deg)":void 0}})]})}),C&&e.jsx(e.Fragment,{children:E.map(((r,v)=>r.type==="sol-transfer"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Transfer ",r.withSeed?"with seed":""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsxs(i,{children:[ne({amount:r.value,decimals:r.token.decimals})," ",r.token.symbol]})]}),!!r.toAccount&&e.jsxs(s,{children:[e.jsx(n,{children:"Destination"}),e.jsx(i,{children:e.jsx(c,{address:r.toAccount,url:t})})]})]},v):r.type==="spl-transfer"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Transfer ",r.token.symbol]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsx(i,{children:r.value.toString()})]}),!!r.fromAta&&e.jsxs(s,{children:[e.jsx(n,{children:"Source"}),e.jsx(i,{children:e.jsx(c,{address:r.fromAta,url:t})})]}),!!r.toAta&&e.jsxs(s,{children:[e.jsx(n,{children:"Destination"}),e.jsx(i,{children:e.jsx(c,{address:r.toAta,url:t})})]}),!!r.token.address&&e.jsxs(s,{children:[e.jsx(n,{children:"Token"}),e.jsx(i,{children:e.jsx(c,{address:r.token.address,url:t})})]})]},v):r.type==="ata-creation"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsx(O,{children:"Create token account"})}),e.jsxs(s,{children:[e.jsx(n,{children:"Program ID"}),e.jsx(i,{children:e.jsx(c,{address:r.program,url:t})})]}),!!r.owner&&e.jsxs(s,{children:[e.jsx(n,{children:"Owner"}),e.jsx(i,{children:e.jsx(c,{address:r.owner,url:t})})]})]},v):r.type==="create-account"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Create account ",r.withSeed?"with seed":""]})}),!!r.account&&e.jsxs(s,{children:[e.jsx(n,{children:"Account"}),e.jsx(i,{children:e.jsx(c,{address:r.account,url:t})})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsxs(i,{children:[ne({amount:r.value,decimals:9})," SOL"]})]})]},v):r.type==="spl-init-account"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsx(O,{children:"Initialize token account"})}),!!r.account&&e.jsxs(s,{children:[e.jsx(n,{children:"Account"}),e.jsx(i,{children:e.jsx(c,{address:r.account,url:t})})]}),!!r.mint&&e.jsxs(s,{children:[e.jsx(n,{children:"Mint"}),e.jsx(i,{children:e.jsx(c,{address:r.mint,url:t})})]}),!!r.owner&&e.jsxs(s,{children:[e.jsx(n,{children:"Owner"}),e.jsx(i,{children:e.jsx(c,{address:r.owner,url:t})})]})]},v):r.type==="spl-close-account"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsx(O,{children:"Close token account"})}),!!r.source&&e.jsxs(s,{children:[e.jsx(n,{children:"Source"}),e.jsx(i,{children:e.jsx(c,{address:r.source,url:t})})]}),!!r.destination&&e.jsxs(s,{children:[e.jsx(n,{children:"Destination"}),e.jsx(i,{children:e.jsx(c,{address:r.destination,url:t})})]}),!!r.owner&&e.jsxs(s,{children:[e.jsx(n,{children:"Owner"}),e.jsx(i,{children:e.jsx(c,{address:r.owner,url:t})})]})]},v):r.type==="spl-sync-native"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsx(O,{children:"Sync native"})}),e.jsxs(s,{children:[e.jsx(n,{children:"Program ID"}),e.jsx(i,{children:e.jsx(c,{address:r.program,url:t})})]})]},v):r.type==="raydium-swap-base-input"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Raydium swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount in"}),e.jsx(i,{children:r.amountIn.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Minimum amount out"}),e.jsx(i,{children:r.minimumAmountOut.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},v):r.type==="raydium-swap-base-output"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Raydium swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Max amount in"}),e.jsx(i,{children:r.maxAmountIn.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount out"}),e.jsx(i,{children:r.amountOut.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},v):r.type==="jupiter-swap-shared-accounts-route"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Jupiter swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"In amount"}),e.jsx(i,{children:r.inAmount.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Quoted out amount"}),e.jsx(i,{children:r.quotedOutAmount.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},v):r.type==="jupiter-swap-exact-out-route"?e.jsxs(F,{children:[e.jsx(s,{children:e.jsxs(O,{children:["Jupiter swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Quoted in amount"}),e.jsx(i,{children:r.quotedInAmount.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount out"}),e.jsx(i,{children:r.outAmount.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},v):e.jsxs(F,{children:[e.jsxs(s,{children:[e.jsx(n,{children:"Program ID"}),e.jsx(i,{children:e.jsx(c,{address:r.program,url:t})})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Data"}),e.jsx(i,{children:r.discriminator})]})]},v)))}),e.jsx(he,{}),k?e.jsx(z,{style:{marginTop:"2rem"},children:k.message}):w?e.jsx(z,{style:{marginTop:"2rem"},children:ve}):null,e.jsx(ke,{$useSmallMargins:!(!w&&!k),title:"",address:b,balance:g,errMsg:u||w||k||!y?void 0:"Add funds on Solana to complete transaction."}),e.jsx(Z,{style:{marginTop:"1rem"},loading:T,disabled:d||u,onClick:N,children:m}),e.jsx(je,{})]})};let ke=h(Qe)`
  ${l=>l.$useSmallMargins?"margin-top: 0.5rem;":"margin-top: 2rem;"}
`,F=h(B)`
  margin-top: 0.5rem;
  border: 1px solid var(--privy-color-foreground-4);
  border-radius: var(--privy-border-radius-sm);
  padding: 0.5rem;
`,ve="There was an error preparing your transaction. Your transaction request will likely fail.",we=h.div`
  display: flex;
  width: 100%;
  justify-content: center;
  max-height: 40px;

  > img {
    object-fit: contain;
    border-radius: var(--privy-border-radius-sm);
  }
`,be=h.span`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
`,Te=h.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--privy-color-foreground);
`,ae=l=>(l==null?void 0:l.code)===Ve.COMPLIANCE_BLOCKED,dr=()=>e.jsxs(jr,{children:[e.jsx(ur,{}),e.jsx(mr,{})]});const Br=({transactionError:l,chainId:a,onClose:o,onRetry:m,chainType:E,transactionHash:p})=>{let{chains:t}=Be(),[y,k]=f.useState(!1),{errorCode:w,errorMessage:I}=((x,g)=>{if(g==="ethereum")return ae(x)?{errorCode:"Transaction blocked",errorMessage:x.message}:{errorCode:x.details??x.message,errorMessage:x.shortMessage};let d=x.txSignature,T=(x==null?void 0:x.transactionMessage)||"Something went wrong.";if(Array.isArray(x.logs)){let u=x.logs.find((S=>/insufficient (lamports|funds)/gi.test(S)));u&&(T=u)}return{transactionHash:d,errorMessage:T}})(l,E),A=ae(l),b=(({chains:x,chainId:g,chainType:d,transactionHash:T})=>{var u,S;return d==="ethereum"?((S=(u=x.find((N=>N.id===g)))==null?void 0:u.blockExplorers)==null?void 0:S.default.url)??"https://etherscan.io":(function(N,D){return`https://explorer.solana.com/tx/${N}?chain=${D}`})(T||"",g)})({chains:t,chainId:a,chainType:E,transactionHash:p});return e.jsxs(e.Fragment,{children:[e.jsx(X,{onClose:o}),e.jsxs(cr,{children:[e.jsx(dr,{}),e.jsx(xr,{children:w}),e.jsx(hr,{children:A?"This transaction cannot be completed.":"Please try again."}),e.jsxs(de,{children:[e.jsx(le,{children:"Error message"}),e.jsx(ce,{$clickable:!1,children:I})]}),p&&e.jsxs(de,{children:[e.jsx(le,{children:"Transaction hash"}),e.jsxs(gr,{children:["Copy this hash to view details about the transaction on a"," ",e.jsx("u",{children:e.jsx("a",{href:b,children:"block explorer"})}),"."]}),e.jsxs(ce,{$clickable:!0,onClick:async()=>{await navigator.clipboard.writeText(p),k(!0)},children:[p,e.jsx(kr,{clicked:y})]})]}),!A&&e.jsx(pr,{onClick:()=>m({resetNonce:!!p}),children:"Retry transaction"})]}),e.jsx(Ue,{})]})};let cr=h.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`,xr=h.span`
  color: var(--privy-color-foreground);
  font-size: 1.125rem;
  font-weight: 500;
  line-height: 1.25rem; /* 111.111% */
  text-align: center;
  margin: 10px;
`,hr=h.span`
  margin-top: 4px;
  margin-bottom: 10px;
  color: var(--privy-color-foreground-3);
  text-align: center;

  font-size: 0.875rem;
  font-style: normal;
  font-weight: 400;
  line-height: 20px; /* 142.857% */
  letter-spacing: -0.008px;
`,jr=h.div`
  position: relative;
  width: 60px;
  height: 60px;
  margin: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
`,mr=h(Ge)`
  position: absolute;
  width: 35px;
  height: 35px;
  color: var(--privy-color-error);
`,ur=h.div`
  position: absolute;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-color: var(--privy-color-error);
  opacity: 0.1;
`,pr=h(Z)`
  && {
    margin-top: 24px;
  }
  transition:
    color 350ms ease,
    background-color 350ms ease;
`,le=h.span`
  width: 100%;
  text-align: left;
  font-size: 0.825rem;
  color: var(--privy-color-foreground);
  padding: 4px;
`,de=h.div`
  width: 100%;
  margin: 5px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`,gr=h.text`
  position: relative;
  width: 100%;
  padding: 5px;
  font-size: 0.8rem;
  color: var(--privy-color-foreground-3);
  text-align: left;
  overflow-wrap: break-word;
`,ce=h.span`
  position: relative;
  width: 100%;
  background-color: var(--privy-color-background-2);
  padding: 8px 12px;
  border-radius: 10px;
  margin-top: 5px;
  font-size: 14px;
  color: var(--privy-color-foreground-3);
  text-align: left;
  overflow-wrap: break-word;
  ${l=>l.$clickable&&`cursor: pointer;
  transition: background-color 0.3s;
  padding-right: 45px;

  &:hover {
    background-color: var(--privy-color-foreground-4);
  }`}
`,fr=h(sr)`
  position: absolute;
  top: 13px;
  right: 13px;
  width: 24px;
  height: 24px;
`,yr=h(Ke)`
  position: absolute;
  top: 13px;
  right: 13px;
  width: 24px;
  height: 24px;
`,kr=({clicked:l})=>e.jsx(l?yr:fr,{});export{Pr as Q,zr as _,Br as o};
