// Interact with the shared ReUI/Base UI select through its visible menu.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
module.exports = async function selectOption(evaluate, selector, value) {
  await evaluate(`(()=>{const trigger=document.querySelector(${JSON.stringify(selector)});if(!trigger)throw Error('Missing select trigger');if(trigger.getAttribute('aria-expanded')!=='true')trigger.click()})()`)
  for (let i=0;i<60;i++) {
    const selected = await evaluate(`(()=>{const option=[...document.querySelectorAll('[data-slot="select-item"]')].find(item=>item.dataset.value===${JSON.stringify(String(value))}&&item.closest('[data-slot="select-content"]')?.hasAttribute('data-open'));if(!option)return false;option.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}));option.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));return true})()`)
    if(selected) { await wait(120); return }
    await wait(100)
  }
  throw Error(`Missing option ${value} in ${selector}`)
}
