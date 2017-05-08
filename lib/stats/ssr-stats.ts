import * as path from 'path'
import * as http from 'http'
import { fork } from 'child_process'
import * as dotenv from 'dotenv'
import CONFIG from '../config/config'
import { getPort } from '../server/server'
import { waitForConnection } from '../util/network'
import { log, logError, prettyJson } from '../util/log'
import { BuildMetrics } from './'
import { formatFileSize } from '../util/fs'
import { getTimeMs, formatTimeMs } from '../util/time'
import { getSequenceAverage } from '../util/math'

dotenv.config()

const { SERVER_OUTPUT, HAS_SERVER } = CONFIG
const port = getPort()

interface SSRStats {
    size: number
    time: number
}

const loadSSRPage = () => (
    new Promise<SSRStats>((resolve, reject) => {
        const startTime = getTimeMs()
        const request = http.get('http://localhost:' + port, (res) => {
            res.setEncoding('utf8')

            let size = 0
            res.on('data', (chunk) => size += chunk.length)

            res.on('end', () => {
                const time = getTimeMs() - startTime
                log('SSR load took ' + time + ' ms')
                resolve({ size, time })
            })
        })
        request.on('error', (err) => reject(err))
    })
)

const ssrStats = async () => {

    if (!HAS_SERVER) {
        log('Skipping SSR stats because the application has no server')
        return {}
    }

    log('Measuring SSR load times...')

    try {
        const serverEntryFile = path.resolve(SERVER_OUTPUT, 'server.js')

        const devServer = fork(
            serverEntryFile,
            [],
            {
                env: process.env,
                silent: true,
            },
        )

        await waitForConnection(port)

        // warm-up
        const { size } = await loadSSRPage()
        await loadSSRPage()
        await loadSSRPage()

        const getTime = () => loadSSRPage()
            .then((result) => result.time)

        const time = await getSequenceAverage(getTime, 5)

        devServer.kill()

        const stats: BuildMetrics = {
            ssr_document_size: formatFileSize(size),
            ssr_loadtime: formatTimeMs(time),
        }

        log(`SSR stats: ${prettyJson(stats)}`)

        return stats
    } catch (e) {
        logError('Error measuring SSR stats')
        return {}
    }
}

export default ssrStats
