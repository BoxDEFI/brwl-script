// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality
import puppeteer from 'puppeteer-extra'

// add stealth plugin and use defaults (all evasion techniques)
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import {ElementHandle, Page} from "puppeteer";
import {createCursor} from "ghost-cursor"

puppeteer.use(require("puppeteer-extra-plugin-minmax")());
puppeteer.use(StealthPlugin())

// puppeteer usage as normal
puppeteer.launch({
  headless: false,
  args: ['--remote-debugging-port=9222', '--mute-audio', '--no-sandbox', '--start-maximized', '--disable-background-timer-throttling', '--window-size=1920,1080', "--window-position=1921,200",
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  ignoreDefaultArgs: ["--enable-automation"],
  userDataDir: './user_data',
  defaultViewport: null
}).then(async browser => {
  const page = (await browser.pages())[0]
  await page.setViewport({width: 0, height: 0});
  console.log(`检测地址: http://localhost:9222/devtools/inspector.html?ws=localhost:9222/devtools/page/${page.target()._targetId}`)
  await page.goto('https://play.bcbrawlers.com/home')
  console.log('检测登陆状态中')
  const cursor = createCursor(page)
  let fightCounter = new Map
  function allFightDone(){
    let sum = 0
    for (let value of fightCounter.values()){
      sum += value
    }
    return sum == 0
  }
  async function fighterFight(fighter:FighterData){
    const [fight] = await fighter.el.$x('//div[4]/div[3]/button[2]')
    if (!fight){
      fightCounter.set(fighter.id,0)
      return null
    }
    const count = fightCounter.get(fighter.id)??0
    fightCounter.set(fighter.id,count + 1)
    if (count == 1){
      console.log(`Fight:${fighter.id}`)
      try{
        await randomClick(fight)
        const continueButton = await page.waitForXPath('//*[@id="root"]/div/div[2]/div[2]/div/div[3]/button',{timeout:40*1000})
        await randomClick(continueButton!!)
        return true
      }catch (e){
        console.error(e)
        return false
      }
    }

    if (count > 40){
      return false
    }
  }

  async function fighterHeal(fighter: FighterData) {
    if (fighter.heart < fighter.maxHeart * random(0.5,0.7)) {
      console.log('开始治疗逻辑')
      await page.waitForTimeout(random(1000, 2000))
      const [heal] = await fighter.el.$x('//div[2]/div[1]/img[contains(@alt, "heal brawler")]')
      if (!heal) {
        console.log(`无法找到治疗按钮`)
        return
      }
      await heal.click()
      const healInput = await page.waitForXPath('//*[@id="root"]/div/div[2]/div[2]/div/div[3]/input', {timeout: 1000 * 20})
      if (!healInput) {
        console.log(`无法找到heal窗口`)
        return
      }
      const rect = (await healInput.boundingBox())!!
      const [x, y] = [rect.x + random(0, 80), rect.y + random(0, 40)]
      await page.mouse.move(x, y)
      await page.mouse.down()
      await cursor.moveTo({x: x + rect.width + random(0, 10), y: y + random(-10, 10)})
      await page.mouse.up()
      console.log(`拖动完成`)
      const [healButton] = await page.$x('//*[@id="root"]/div/div[2]/div[2]/div/div[4]/button')
      await randomClick(healButton)
    }
  }

  function waitPageLoad(){
    return page.waitForXPath("//span[contains(text(),'Rates subject to change')]")
  }
  const signed = await waitPageLoad()
  if (signed) {
    await minimize(page)
    console.log(`成功检测到登陆状态`)
  }
  console.log(`登陆状态检测完成`)
  //每隔10分钟刷新一次页面重复流程
  //检测摔跤手
  let fighters:FighterData[] = [];

  async function fetchFighter(){
    fighters = []
    while (true) {
      await page.waitForTimeout(1000)

      const result = await page.$x("//*[@id=\"root\"]/div/div[2]/div")
      if (result.length > 0) {
        for (let one of result) {
          const data = await getFighterData(one)
          if (data !== false) {
            fighters.push(data)
            console.log(`监测到拳击手:${data.id},当前状态:${data.heart}/${data.maxHeart}`)
          }
        }
        break
      }
    }
  }
  await fetchFighter()
  let counter = 1800

  async function fetchStatus (){
    const goldEl = await page.waitForXPath('//*[@id="root"]/div/div[1]/div/div/div[1]/span[2]')
    if (!goldEl){
      console.log('无法获取状态')
      return
    }
    const gold = await elText(goldEl)
    const brwlEl = await page.waitForXPath('//*[@id="root"]/div/div[1]/div/div/div[2]/div[1]/div[2]')
    if (!brwlEl){
      console.log('无法获取brwl状态')
      return
    }
    const brwl = await elText(brwlEl)
    return {
      gold:parseInt(<string>gold),
      brwl:parseFloat(<string>brwl)
    }
  }
  let status = await fetchStatus()
  let fightCount = 0
  console.log(`当前状态:[Gold|${status?.gold}],[BRWL|${status?.brwl}]`)
  while (true){
    await page.waitForTimeout(1000)
    {//heal
      if (++counter >= 30 * 60){
        try{
          for (let fighter of fighters) {
            await fighterHeal(fighter)
          }
        }catch (e){
          console.error(e)
        }
        counter = 0
      }
    }

    {//fight
      for (let fighter of fighters){
        try{
          const status = await fighterFight(fighter)
          if (status === false){
            console.log('开始重载页面')
            await page.reload()
            await waitPageLoad()
            await fetchFighter()
            break
          }else if (status === true){
            ++fightCount
          }
        }catch (e) {
          console.error(e)
        }
      }
    }

    {
      if (allFightDone() && fightCount > 0){
        const newStatus = await fetchStatus()
        console.log(`战斗结束,收益：[Gold|${newStatus?.gold!! - status?.gold!!}],[BRWL|${newStatus?.brwl!! - status?.brwl!!}]`)
        status = newStatus
        fightCount = 0
      }
    }
  }
  console.log('未知结束方式')
})

async function randomClick(el:ElementHandle<Element>){
  const rect = await el.boundingBox()
  await el.click({delay:random(500,1000),offset:{x:random(0,<number>rect?.width),y:random(0,<number>rect?.height)}})
}

function random(start: number, end: number) {
  return start + (end - start) * Math.random()
}

interface FighterData {
  id: string,
  name: string
  heart: number,
  maxHeart: number,
  el: ElementHandle<Element>
}

async function elText(el:ElementHandle<Element>){
  return (await el.getProperty('innerText')).jsonValue()
}

async function getFighterData(one: ElementHandle<Element>): Promise<FighterData | false> {
  const text = await (await one.getProperty('innerText')).jsonValue() as string
  if (text.includes('#')) {
    const data = text.split('\n')
    const [heart, maxHeart] = data[4].split('/')
    return {
      id: data[0],
      name: data[1],
      heart: parseFloat(heart),
      maxHeart: parseFloat(maxHeart),
      el: one
    }
  }
  return false
}

async function minimize(page: Page) {
  const session = await page.target().createCDPSession();
  const goods = await session.send("Browser.getWindowForTarget");
  const {windowId} = goods;
  await session.send("Browser.setWindowBounds", {
    windowId,
    bounds: {windowState: "minimized"},
  });

  return;
}

async function maximize(page: Page) {
  const session = await page.target().createCDPSession();
  const goods = await session.send("Browser.getWindowForTarget");
  const {windowId} = goods;
  await session.send("Browser.setWindowBounds", {
    windowId,
    bounds: {windowState: "normal"},
  });
}
