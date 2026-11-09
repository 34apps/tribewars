import React from 'react'; (globalThis as any).React = React;
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon } from '../../../../apps/web/src/art/Icon';
import { writeFileSync } from 'node:fs';
const names = ['flame','bell','village','map','army','reports','mail','tribe','ranks','warning','shield','pop','wood','food','iron','gold','time','back','close','renown','upgrade','queue','chieftain'] as const;
const html = renderToStaticMarkup(<>{names.map(n=><div key={n} data-n={n}><Icon name={n as any} size={64}/></div>)}</>);
writeFileSync(new URL('./icons.html', import.meta.url).pathname, html);
console.log(html.length);
