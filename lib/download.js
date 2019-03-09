const fs = require('fs')
const config = require('./config')
const util = require('./util')
const bar = util.progressbar()

// 紀錄已經開始下載的任務數
let downloadStartCount = 0
// 紀錄已經結束下載的任務數
let downloadEndCount = 0

// 需要下載影片的信息的陣列
let objArray = []
// 下載成功的影片信息陣列
let successObjArray = []

/**
 * 下載影片
 *
 * @param {Function} callback
 */
function download(callback) {
  if (downloadStartCount < objArray.length) {
    const obj = objArray[downloadStartCount]
    downloadStartCount++

    return new Promise((resolve, reject) => {
      const fs = require('fs')
      const http = require(!/^https/.test(obj.url) ? 'http' : 'https')

      // 建立檔案
      let fd = fs.openSync(obj.name, 'w')

      // 使用 HTTP 下載影片
      http.get(obj.url, async res => {

        const name = obj.name.match(/\d+\.ts$/)

        // 如果返回錯誤 (4xx 或 5xx)
        if (/^[45]\d{2}$/.test(res.statusCode)) {
          fs.closeSync(fd)
          fs.unlink(obj.name, () => { })
          downloadEndCount++

          switch (res.statusCode) {
            case 404:
              bar.increment(1, {
                text: util.textColor(`影片不存在：${name}`, 'red')
              })
              break

            case 403:
              bar.increment(1, {
                text: util.textColor(`影片已過期：${name}`, 'red')
              })
              break

            default:
              bar.increment(1, {
                text: util.textColor(`下載錯誤：${name}`, 'red')
              })
              break
          }

          // 下載下一部影片
          download(callback)

          resolve()
          return
        }

        // 返回成功
        let dataArray = []
        res.on('data', (data) => {
          dataArray.push(data)
        })
        res.on('end', async () => {
          // 寫入檔案
          for (let key in dataArray) {
            fs.writeSync(fd, dataArray[key], 0, dataArray[key].length, null)
          }
          fs.closeSync(fd)
          downloadEndCount++
          bar.increment(1, {
            text: util.textColor(`已下載：${name}`, 'green')
          })

          // 下載成功的影片信息陣列
          successObjArray.push(obj)

          // 下載下一部影片
          download(callback)

          resolve()
          return
        })

      }).on('error', error => {
        reject(error)
        return
      })
    }).then(() => {
      // 最後一個任務
      if (callback && downloadEndCount === objArray.length) {
        callback()
      }
    })
  }
}

module.exports = options => {
  let opts = Object.assign({}, config, options)

  return new Promise((resolve, reject) => {

    // 紀錄已經開始下載的任務數
    downloadStartCount = 0
    // 紀錄已經結束下載的任務數
    downloadEndCount = 0

    // 需要下載影片的信息的陣列
    objArray = []
    // 下載成功的影片信息陣列
    successObjArray = []

    // 同時下載的最大任務數
    const downloadThread = opts.max

    /**
     * 輸入路徑
     * @param {string|null} filename
     */
    const inputPath = (filename = '') => util.inputPath(opts.input, filename)

    /**
     * 暫存資料夾
     */
    // 判斷 input 資料夾是否存在
    if (!fs.existsSync(inputPath())) {
      reject(`請新增 ${inputPath()} 資料夾`)
      return
    }
    if (!fs.existsSync(inputPath(opts.m3u8))) {
      reject(`請將 ${opts.m3u8} 檔移至 ${inputPath()} 資料夾裡`)
      return
    }

    util.consoleSuccess(`開始下載：${opts.name}`)

    // 建立主要下載暫存資料夾
    util.mkdir(util.mainCachePath(), true)
    // 刪除並建立下載暫存資料夾
    util.rmdir(util.cachePath(opts.name))
    util.mkdir(util.cachePath(opts.name))

    /**
     * 讀取 m3u8 檔
     */
    fs.readFile(inputPath(opts.m3u8), 'utf-8', async (error, data) => {
      if (error) {
        reject(error)
        return
      }

      // 逐行讀取 m3u8 中的 URL
      let array
      let index = 0
      while (array = util.m3u8UrlReg.exec(data)) {
        let obj = {}

        obj.url = array[0] + ''
        obj.name = util.cachePath(opts.name, `${index}.ts`)

        objArray.push(obj)
        index++
      }

      /**
       * 沒有匹配的連結
       */
      if (!objArray.length) {
        // 刪除快取資料夾
        util.rmdir(util.cachePath(opts.name))
        util.rmdir(util.mainCachePath(), false)
        reject({
          message: '執行完成：沒有匹配的連結',
          color: 'yellow'
        })
        return
      }

      /**
       * 遍歷陣列，逐個下載影片
       */
      bar.start(objArray.length, 0, { text: '' })

      for (let start = downloadStartCount; downloadStartCount < objArray.length;) {
        // 如果已經超過可同時下載的最大任務數，就退出；
        // 等待有任務結束(不管成功或失敗)才繼續下載。
        if (downloadStartCount === (start + downloadThread)) {
          break
        }

        /**
         * 下載影片
         */
        download(() => {
          bar.stop()
          resolve(successObjArray)
        }).catch(error => {
          reject(error)
          return
        })
      }
    })

  })
}