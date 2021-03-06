declare var _: any
import {Injectable} from 'angular2/core'
import {ApiService} from './ApiService'
import {ModelService} from './ModelService'
import {SettingsService} from './SettingsService'
import {ShackMessageService} from './ShackMessageService'
import {TabService} from './TabService'
import {TitleService} from './TitleService'
import {ToastService} from './ToastService'

@Injectable()
export class EventService {
    private lastEventId = 0
    private passiveMode = false

    constructor(private apiService:ApiService,
                private modelService:ModelService,
                private settingsService:SettingsService,
                private shackMessageService:ShackMessageService,
                private tabService:TabService,
                private titleService:TitleService,
                private toastService:ToastService) {

        //update loop every 5 min
        setInterval(() => {
            this.modelService.updateAllThreads()
            this.shackMessageService.refresh()
            this.settingsService.refresh()
        }, 300000)
    }

    public startActive() {
        this.modelService.clear()

        this.apiService.getNewestEventId()
            .then(response => this.lastEventId = _.get(response, 'eventId'))
            .catch(response => {
                console.error('Error during getNewestEventId.', response)
                this.toastService.create('Error getting newest event id.')
            })

        this.apiService.getChatty()
            .then(response => {
                //process all threads
                _.each(response.threads, thread => this.modelService.addThread(thread, null))

                //clean collapsed thread list after initial load
                this.modelService.cleanCollapsed()

                //reorder pinned threads
                this.handlePinnedThreads()

                //start events
                return this.waitForEvents()
            })
            .catch(response => {
                console.error('Error during getChatty: ', response)
                this.toastService.create('Error getting chatty. Please reload page.')
            })

        this.shackMessageService.refresh()
    }

    public startPassive() {
        this.passiveMode = true
        this.titleService.setPassive()

        window.addEventListener('storage', event => {
            if (event.key === 'event') {
                var data = JSON.parse(event.newValue)
                var result = this.newEvent(data)

                //update title bar count
                if (result) {
                    this.titleService.updateTitle(1)
                }
            }
        })
    }

    private handlePinnedThreads() {
        var pinnedThreads = this.settingsService.getPinned()
        var threads = this.modelService.getThreads()

        _.each(pinnedThreads, threadId => {
            var thread = this.modelService.getPost(threadId)
            if (!thread) {
                //load expired thread
                this.apiService.getThread(threadId)
                    .then(response => {
                        var thread = _.get(response, 'threads[0]')
                        if (thread) {
                            thread = this.modelService.addThread(thread, false)
                            thread.pinned = true

                            //put it at the top of the list
                            _.pull(threads, thread)
                            threads.unshift(thread)
                        }
                    })
                    .catch(response => {
                        let msg = `Error loading pinned threadId=${threadId}.`
                        console.error(msg, response)
                        this.toastService.create(msg)
                    })
            } else {
                //put it at the top of the list
                thread.pinned = true
                _.pull(threads, thread)
                threads.unshift(thread)
            }
        })
    }

    private waitForEvents() {
        this.apiService.waitForEvent(this.lastEventId)
            .then(response => this.eventResponse(response))
            .catch(response => {
                console.error('Error during waitForEvent', response)
                this.toastService.create('Error getting next chatty event.')
                this.eventResponse(response)
            })
    }

    private eventResponse(data) {
        if (data && !data.error) {
            this.lastEventId = data.lastEventId || this.lastEventId

            //process the events
            _.each(data.events, event => this.newEvent(event))

            //wait for more
            this.waitForEvents()
        } else if (data && data.error && data.code === 'ERR_TOO_MANY_EVENTS') {
            console.error('Too many events since last refresh, reloading chatty.')
            this.toastService.create('Too many events since last refresh. Reloading full chatty.')
            this.startActive()
        } else {
            //restart events in 30s
            console.error('Unknown error', data)
            this.toastService.create('Unknown error with event. Restarting events in 30 seconds.')
            setTimeout(() => this.waitForEvents(), 30000)
        }
    }

    private newEvent(event) {
        //store the event for other tabs to process
        if (!this.passiveMode) {
            localStorage.setItem('event', JSON.stringify(event))
        }

        if (event.eventType === 'newPost') {
            if (event.eventData.post.parentId === 0 && !this.passiveMode) {
                return this.modelService.addThread(event.eventData.post, true)
            } else {
                var data = this.modelService.addPost(event.eventData.post, null)
                if (data) {
                    this.tabService.newPost(data.thread, data.parent, data.post)
                }
                return data
            }
        } else if (event.eventType === 'categoryChange') {
            return this.modelService.changeCategory(event.eventData.postId, event.eventData.category)
        } else if (event.eventType === 'lolCountsUpdate') {
            //not supported
        } else {
            console.error('Unhandled event', event)
            this.toastService.create('Unhandled chatty event.')
        }
    }
}
