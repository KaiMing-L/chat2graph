import styles from './index.less';
import { Button, GetProp, Tooltip, Flex, Spin, message, Space, Popconfirm, Alert } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, LayoutFilled, RightOutlined, LeftOutlined } from '@ant-design/icons';
import {
  Attachments,
  Bubble,
  Conversations,
  ConversationsProps,
  Prompts,
  Sender,
  useXAgent,
  useXChat,
} from '@ant-design/x';
import { useImmer } from 'use-immer';
import NameEditor from '@/components/NameEditor';
import { CURRENT_PREFIXES, FRAMEWORK_CONFIG, LOCAL_STORAGE_SESSION_KEY, LOCAL_STORAGE_STOP_KEY, MESSAGE_TYPE, MOCK_placeholderPromptsItems, ROLES } from '@/constants';
import Placeholder from '@/components/Placeholder';
import SenderHeader from '@/components/SenderHeader';
import { useCallback, useEffect } from 'react';
import { useSessionEntity } from '@/domains/entities';
import useIntlConfig from '@/hooks/useIntlConfig';
import Language from '@/components/Language';
import logoSrc from '@/assets/logo.png';
import BubbleContent from '@/components/BubbleContent';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { cloneDeep, isEmpty } from 'lodash';
import { historyPushLinkAt } from '@/utils/link';
import { useDatabaseEntity } from '@/domains/entities/database-manager';

const HomePage: React.FC = () => {

  const { getLocalStorage, setLocalStorage, removeLocalStorage } = useLocalStorage()

  const [state, setState] = useImmer<{
    selectedFramework?: string;
    conversationsItems: ConversationsProps['items'];
    headerOpen: boolean;
    activeKey: string;
    collapse: boolean;
    placeholderPromptsItems: { labelId: string, key: string }[];
    content: string;
    attachedFiles: GetProp<typeof Attachments, 'items'>;
    isInit: boolean;
    uplodaFileIds: { file_id: string, uid: string }[];
    closeTag: boolean;
    editing: boolean;
  }>({
    conversationsItems: [],
    headerOpen: false,
    activeKey: '',
    collapse: false,
    placeholderPromptsItems: MOCK_placeholderPromptsItems,
    content: '',
    attachedFiles: [],
    isInit: false,
    uplodaFileIds: [],
    closeTag: false,
    editing: false,
  });


  const { editing, isInit, conversationsItems, activeKey, collapse, placeholderPromptsItems, content, attachedFiles, headerOpen, uplodaFileIds, closeTag, selectedFramework } = state;

  const { formatMessage } = useIntlConfig();

  const { getDatabaseList, databaseEntity } = useDatabaseEntity()

  const {
    sessionEntity,
    getSessionList,
    loadingGetSessions,
    runCreateSession,
    runUpdateSession,
    runDeleteSession,
    runGetSessionById,
    runGetJobResults,
    runGetJobIdsBySessionId,
    runGetMessagesBySessionId,
    runStopSession,
    runRecoverSession
  } = useSessionEntity();

  const { sessions } = sessionEntity;


  const onConversationRename = (name: React.ReactNode, key: string) => {
    runUpdateSession({
      session_id: key,
    }, {
      name: name as string,
    }).then((res: API.Result_Session_) => {
      const { success } = res;
      if (success) {
        getSessionList();
      }
    });
  };

  let timer: any = null;

  const transformMessage = (answer: any) => {
    if (!answer) return null;
    const { message: { instruction_message, attached_messages }, thinking, metrics } = answer || {};

    const thinkingList = thinking?.map((item: any) => {
      const { message: thinkMsg, metrics, job } = item

      return {
        payload: thinkMsg?.payload,
        message_type: thinkMsg?.message_type,
        status: metrics?.status,
        job
      }
    })
    return {
      payload: instruction_message?.payload,
      session_id: instruction_message?.session_id,
      job_id: instruction_message?.job_id,
      role: instruction_message?.role,
      attached_messages,
      thinking: thinkingList,
      status: metrics?.status
    }
  }


  const onStop = () => {
    runStopSession({
      session_id: activeKey
    })

  }

  const getMessage = useCallback((job_id: string, onSuccess: (message: any) => void, onUpdate: (message: any) => void) => {
    timer = setTimeout(() => {
      runGetJobResults({
        job_id,
      }).then(res => {
        const { status } = res?.data?.answer?.metrics || {};
        if (getLocalStorage(LOCAL_STORAGE_STOP_KEY) === "true") {
          onSuccess({})
          // TODO 停止思考逻辑
          // onSuccess({
          //   payload: 'STOP',
          //   session_id: res?.data?.answer?.message?.session_id,
          //   job_id,
          //   role: res?.data?.answer?.message?.role,
          //   thinking: []
          // });
          removeLocalStorage(LOCAL_STORAGE_STOP_KEY)
          return;
        }

        if (['RUNNING', 'CREATED'].includes(status)) {
          onUpdate(transformMessage(res?.data?.answer))
          getMessage(job_id, onSuccess, onUpdate);
          return;
        }
        clearTimeout(timer);
        onSuccess(transformMessage(res?.data?.answer));
      });
    }, 2000)
  }, [closeTag])

  const getAttached = () => {
    const uid_list = attachedFiles?.map(item => item?.uid);
    const attached_messages: { file_id: string, message_type: string, name: string, size: number }[] = []
    uplodaFileIds?.forEach(item => {
      if (uid_list.includes(item?.uid)) {
        const { name, size } = attachedFiles?.find((fileItem: any) => fileItem?.uid === item.uid)

        attached_messages.push({
          file_id: item?.file_id,
          message_type: 'FILE',
          name,
          size
        })
      }
    })

    return attached_messages
  }

  const [agent] = useXAgent<API.ChatVO>({
    request: async ({ message: msg }, { onSuccess, onUpdate }) => {
      const { payload = '', session_id = '', attached_messages, isRunning, assigned_expert_name } = msg || {};

      // 继续思考
      if (isRunning) {
        getMessage(payload, onSuccess, onUpdate);
        return
      }

      runGetJobIdsBySessionId({
        session_id,
      }, {
        instruction_message: {
          payload,
          message_type: 'TEXT',
          assigned_expert_name,
        },
        attached_messages,
      }).then((res: API.Result_Chat_) => {
        const { job_id = '' } = res?.data || {};
        getMessage(job_id, onSuccess, onUpdate);
        onUpdate(res?.data || {})
        setState((draft) => {
          draft.uplodaFileIds = []
          draft.attachedFiles = []
          draft.headerOpen = false;
        });

      });
    },

  });
  const { onRequest, parsedMessages, setMessages } = useXChat({
    agent,
    parser: (agentMessages) => {
      return agentMessages;
    }
  });


  // 更新输入内容
  const updateContent = (newContent: string = '') => {
    setState((draft) => {
      draft.content = newContent;
    })
  }

  const getHistoryMessage = (data: API.JobVO) => {

    const { answer, question } = data || {};
    const viewItem = [
      {
        id: question?.message?.id,
        message: question?.message,
        status: 'success',
      },
      {
        id: answer?.message?.id,
        message: transformMessage(answer),
        status: 'success',
      }
    ]

    return viewItem
  }

  const onConversationClick: GetProp<typeof Conversations, 'onActiveChange'> = (key: string) => {
    // 切换时，有思考中任务，则停止
    if (agent.isRequesting()) {
      setLocalStorage(LOCAL_STORAGE_STOP_KEY, true)
    }

    setState((draft) => {
      draft.selectedFramework = undefined;
    })

    runGetSessionById({
      session_id: key,
    }).then((res: API.Result_Session_) => {
      if (res.success) {
        setState((draft) => {
          draft.activeKey = key;
          draft.uplodaFileIds = []
          draft.attachedFiles = []
          draft.headerOpen = false;
        });
      }
    });

    runGetMessagesBySessionId({
      session_id: key,
    }).then((res: API.Result_Messages_) => {

      if (res?.data?.length) {
        setState((draft) => {
          draft.isInit = true;
        });
      }

      const historyMessages: any = res?.data?.map(item => getHistoryMessage(item))?.flat() || []

      if (historyMessages?.length && [MESSAGE_TYPE.RUNNING, MESSAGE_TYPE.CREATED].includes(historyMessages[historyMessages?.length - 1]?.message?.status)) {
        onRequest({
          payload: historyMessages[historyMessages?.length - 1]?.message?.job_id,
          isRunning: true,
        })

        historyMessages.pop()
      }
      setMessages(historyMessages)
    })

    removeLocalStorage(LOCAL_STORAGE_SESSION_KEY)
  };

  const onRecoverSession = () => {
    runRecoverSession({
      session_id: activeKey
    })
    const newParsedMessages = cloneDeep(parsedMessages)
    const lastMessage = newParsedMessages?.pop()
    onRequest({
      payload: lastMessage?.message?.job_id,
      isRunning: true,
    })
    setMessages(newParsedMessages)
  }

  const items: GetProp<typeof Bubble.List, 'items'> = parsedMessages?.filter(item => !isEmpty(item?.message)).map((item, idx, all) => {
    // @ts-ignore
    const { message, id, } = item;
    return {
      key: id,
      loading: message?.role === 'SYSTEM' && !message?.thinking,
      role: message?.role === 'SYSTEM' ? 'ai' : 'local',
      content: message?.payload || message?.instruction_message?.payload || formatMessage('home.noResult'),
      avatar: message?.role === 'SYSTEM' ? {
        icon: <img src={logoSrc} />
      } : undefined,
      typing: (message?.role === 'SYSTEM' && !isInit) ? { step: 3, interval: 50 } : false,
      messageRender: (text) => {
        return message?.role === 'SYSTEM' ? <BubbleContent onRecoverSession={onRecoverSession} key={id} isLast={idx === all.length - 1} status={message?.status} message={message} content={text} /> : <div className={styles['user-conversation']}>
          <pre className={styles['user-conversation-question']}>{text}</pre>
          {
            <Flex vertical gap="middle">
              {(message?.attached_messages as any[])?.map((item) => {
                const fileItem = {
                  name: item.name,
                  size: +item?.size,
                }
                return <Attachments.FileCard key={item.uid} item={fileItem} />
              })}
            </Flex>
          }
        </div>
      },
      onTypingComplete: () => {
        const newMessages = parsedMessages?.filter(item => !isEmpty(item?.message)).map((newItem, newIdx) => {
          if (newIdx === idx) {
            return {
              ...newItem,
              message: {
                ...newItem.message,
                isTyping: true
              }
            }
          }
          return newItem;
        })
        setMessages(newMessages)
      }

    }
  });


  // 新增会话
  const onAddConversation = () => {
    setMessages([]);
    setState((draft) => {
      draft.selectedFramework = undefined;
    })
    if (agent.isRequesting()) {
      setLocalStorage(LOCAL_STORAGE_STOP_KEY, true)
    }
  };

  const removePrefix = (inputString) => {
    for (const prefix of CURRENT_PREFIXES) {
      if (inputString.startsWith(prefix)) {
        return inputString.slice(prefix.length).trim();
      }
    }
    return inputString.trim();
  }


  const menuConfig: ConversationsProps['menu'] = (conversation) => ({
    trigger: () => {
      return <div id='conversation-extra'>
        <Space>
          <Tooltip title={formatMessage('home.rename')} placement='left'>
            <div className={styles['conversation-extra-icon']} onClick={(e) => {
              e.stopPropagation();
              if (editing) return

              setState((draft) => {
                draft.editing = true;
              })
              setState((draft) => {
                draft.conversationsItems = (draft.conversationsItems || []).map(item => {
                  if (item.key !== conversation.key) {
                    return item;
                  }
                  return {
                    ...item,
                    label: <NameEditor
                      name={removePrefix(item.label)}
                      onEdited={() => {
                        setState((draft) => {
                          draft.editing = false;
                        })
                      }}
                      onConfirm={(name: React.ReactNode) => {
                        onConversationRename(name, conversation.key);
                      }}
                    />,
                  };
                });
              })
            }
            } >
              <EditOutlined />
            </div>
          </Tooltip>

          <Popconfirm
            title={formatMessage('home.deleteConversation')}
            okText={formatMessage('home.confirm')}
            cancelText={formatMessage('home.cancel')}
            onConfirm={(e: any) => {
              e.stopPropagation()
              runDeleteSession({
                session_id: conversation.key,
              }).then((res: API.Result_Session_) => {
                if (res?.success) {
                  getSessionList();
                  message.success(formatMessage('home.deleteConversationSuccess'));
                  if (activeKey === conversation.key) {
                    if (agent.isRequesting()) {
                      setLocalStorage(LOCAL_STORAGE_STOP_KEY, true)
                    }
                    setState((draft) => {
                      draft.activeKey = ''
                    })
                    setMessages([])
                  }
                }
              })
            }}
          >
            <Tooltip title={formatMessage('home.delete')} placement='right'>
              <div className={styles['conversation-extra-icon']} onClick={(e) => { e.stopPropagation(); }}>
                <DeleteOutlined />
              </div>
            </Tooltip>
          </Popconfirm>
        </Space>
      </div>
    },
    items: [],
  });

  const onSubmit = (nextContent: string) => {
    if (!nextContent || agent.isRequesting() || attachedFiles?.some(item => item?.status === 'uploading')) return;
    setState((draft) => {
      draft.isInit = false;
    });

    // 新建对话
    if (!items.length) {
      runCreateSession({
        name: nextContent,
      }).then((res: API.Result_Session_) => {
        if (res.success) {
          getSessionList();
          setState((draft) => {
            draft.activeKey = res?.data?.id || '';
          });
          onRequest({
            payload: nextContent,
            session_id: res?.data?.id,
            attached_messages: getAttached(),
            assigned_expert_name: selectedFramework || null
          });
          updateContent('');
        }
      });
      return;
    }

    // 已有对话更新
    onRequest({
      payload: nextContent,
      session_id: state.activeKey,
      attached_messages: getAttached(),
      assigned_expert_name: selectedFramework || null
    });
    updateContent('');
  };

  // 点击推荐项
  const onPromptsItemClick: GetProp<typeof Prompts, 'onItemClick'> = (info) => {
    onSubmit(info.data.label as string)
  };

  const handleFileChange: GetProp<typeof Attachments, 'onChange'> = (info) => {
    setState((draft) => {
      draft.attachedFiles = info.fileList;
    })
  }



  useEffect(() => {
    setState((draft) => {
      draft.editing = false;
      draft.conversationsItems = sessions?.map(item => {
        return {
          ...item,
          label: `${item?.key === activeKey ? formatMessage('home.current') : ''}${item?.label}`,
          group: formatTimestamp(formatMessage, item?.timestamp)
        }
      })
    })
  }, [sessions, activeKey]);



  // 初始化请求对话列表
  useEffect(() => {
    getSessionList();
    getDatabaseList();

    const managerSessionId = getLocalStorage(LOCAL_STORAGE_SESSION_KEY);

    if (managerSessionId) {
      onConversationClick(managerSessionId)
    }
  }, []);

  const onAddUploadId = (fileId: { file_id: string, uid: string }) => {
    setState((draft) => {
      draft.uplodaFileIds = [...draft.uplodaFileIds, fileId]
    })
  }

  const onTranslate = (items: { labelId: string, key: string }[]): GetProp<typeof Prompts, 'items'> => {
    return items.map(item => {
      return {
        ...item,
        label: formatMessage(item.labelId),
      }
    })
  }
  return (
    <div className={styles.wrapper}>
      <Language />
      <div className={`${styles.sider} ${collapse ? styles['sider-collapsed'] : ''}`}>
        <div className={styles.title}>
          <span className={styles['title-text']}>
            <img src={logoSrc} className={styles['title-logo']} />
            {
              !collapse && <span>Chat2Graph</span>
            }
          </span>

          <div className={styles['sider-collapsed-icon']} onClick={() => { setState((draft) => { draft.collapse = !draft.collapse; }) }}>
            {
              collapse ? <RightOutlined /> : <LeftOutlined />
            }
          </div>
        </div>

        <Tooltip title={collapse ? formatMessage('home.openNewConversation') : ''}>
          <Button
            onClick={onAddConversation}
            type={collapse ? 'text' : 'primary'}
            className={styles['create-conversation']}
            icon={<PlusOutlined style={{ fontSize: '13px', color: '#1677ff' }} />}
            size='large'
            block
            ghost={collapse ? true : false}
          >
            {collapse ? '' : formatMessage('home.openNewConversation')}
          </Button>
        </Tooltip>

        <Spin spinning={loadingGetSessions} >
          <Conversations
            items={conversationsItems}
            className={styles.conversations}
            activeKey={activeKey}
            onActiveChange={onConversationClick}
            menu={menuConfig}
            groupable
          />
        </Spin>

        <p className={styles.tips}>{formatMessage('home.tips')}</p>

        <Tooltip title={collapse ? formatMessage('home.manager') : ''}>
          <Button
            onClick={() => {
              window.open(historyPushLinkAt('/manager/knowledgebase'), '_blank')
            }}
            type={'text'}
            className={`${styles['go-manager']} ${collapse ? styles['go-manager-collapsed'] : ''}`}
            style={collapse ? { bottom: 52 } : {}}
            icon={<LayoutFilled />}
            size='large'
            block
            ghost={collapse ? true : false}
          >
            {collapse ? '' : formatMessage('home.manager')}
          </Button>
        </Tooltip>

      </div>

      <div className={
        [styles.chat,
        !items?.length ? styles['chat-emty'] : ''].join(' ')}>
        {!databaseEntity?.databaseList?.length ? <Alert message={
          <div>
            {formatMessage('home.tip')}
            <a href={historyPushLinkAt('/manager/graphdb')} target="_blank" rel="noreferrer">{formatMessage('home.click')}</a>
          </div>
        } type="error" /> : null}
        {/* 消息列表 */}
        <Bubble.List
          items={items.length > 0 ? items : [{
            content: <Placeholder
              placeholderPromptsItems={onTranslate(placeholderPromptsItems)}
              onPromptsItemClick={onPromptsItemClick}
            />,
            variant: 'borderless',
          }]}
          roles={ROLES}
          className={`${styles.messages} ${!items.length ? styles.welcome : ''} ${!databaseEntity?.databaseList?.length ? styles['has-tip'] : ''}`}
        />


        <footer className={styles.footer}>
          {/* 输入框 */}
          <Sender
            value={content}
            header={<SenderHeader
              open={headerOpen}
              onAddUploadId={onAddUploadId}
              attachedFiles={attachedFiles}
              handleFileChange={handleFileChange}
              onOpenChange={(open: boolean) => {
                setState((draft) => {
                  draft.headerOpen = open;
                });
              }}
            />}
            onSubmit={onSubmit}
            onChange={updateContent}
            actions={false}
            placeholder={formatMessage('home.placeholder')}
            className={styles.sender}
            footer={({ components }) => {
              const { SendButton, LoadingButton } = components;
              return (
                <Flex justify="space-between" align="start">
                  <Flex gap="small" align="center" className={styles['framework']}>
                    {FRAMEWORK_CONFIG.map(item => <Button
                      key={item.key}
                      type={state.selectedFramework === item.key ? 'primary' : 'default'}
                      onClick={() => {
                        setState((draft) => {
                          draft.selectedFramework = draft.selectedFramework === item.key ? undefined : item.key;
                        })
                      }}
                    >
                      <i className={`iconfont  ${item.icon}`} style={{
                        fontSize: '20px'
                      }} />{formatMessage(`home.expert.${item.textId}`)}
                    </Button>)}

                  </Flex>
                  <Flex align="center" gap={12}>
                    <Tooltip title={formatMessage('knowledgebase.detail.upload.description')}>
                      <Button
                        type="text"
                        icon={<i className='iconfont  icon-Chat2graphshangchuan' style={{
                          fontSize: 30, color: '#6a6b71'
                        }} />}
                        onClick={() => {
                          setState((draft) => {
                            draft.headerOpen = !draft.headerOpen;
                          })
                        }}
                      />
                    </Tooltip>
                    {agent.isRequesting() ? (
                      <Tooltip title={'点击停止生成'}>
                        <div onClick={onStop} >
                          <LoadingButton type="default" />
                        </div>
                      </Tooltip>
                    ) : (
                      <Tooltip title={formatMessage(`home.${content ? 'send' : 'placeholder'}`)}>
                        <SendButton type="primary" disabled={!content} />
                      </Tooltip>
                    )}
                  </Flex>
                </Flex>
              );
            }}
          />
        </footer>
      </div>
    </div >
  );
};

export default HomePage;

