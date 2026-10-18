import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
export function Motion() {
 const {pathname}=useLocation();
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)'); if(media.matches||!('IntersectionObserver' in window))return;
  const observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-revealed');observer.unobserve(e.target);}});},{threshold:.08,rootMargin:'0px 0px -24px 0px'});
  let frame;const observe=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{document.querySelectorAll('main .section-intro, main .journey, main .process-line li, main .operations-story, main .guide-card, main .guide-body section, main .card.link, main .country-grid>a').forEach((el,i)=>{if(el.dataset.reveal)return;el.dataset.reveal='true';el.style.setProperty('--reveal-delay',`${Math.min(i%3,2)*65}ms`);observer.observe(el);});});};
  observe();const mutations=new MutationObserver(observe);const main=document.querySelector('main');if(main)mutations.observe(main,{childList:true,subtree:true});
  return()=>{observer.disconnect();mutations.disconnect();cancelAnimationFrame(frame);document.querySelectorAll('[data-reveal]').forEach(el=>{el.classList.add('is-revealed');delete el.dataset.reveal;});};
 },[pathname]);
 useEffect(()=>{let frame;const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const max=document.documentElement.scrollHeight-innerHeight;document.documentElement.style.setProperty('--reading-progress',max>0?Math.min(1,scrollY/max):0);document.documentElement.classList.toggle('page-scrolled',scrollY>24);});};update();addEventListener('scroll',update,{passive:true});addEventListener('resize',update);return()=>{cancelAnimationFrame(frame);removeEventListener('scroll',update);removeEventListener('resize',update);};},[pathname]);
 return <div className="reading-progress" aria-hidden="true" />;
}
