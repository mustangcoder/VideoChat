import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layout, Upload, Button, Input, Card, message, Table, Tabs, Pagination, Checkbox } from 'antd';
import { UploadOutlined, SendOutlined, SoundOutlined, SyncOutlined, DownloadOutlined, CopyOutlined, StopOutlined, DeleteOutlined, GithubOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Mermaid from 'mermaid';
import './App.css';
import jsMind from 'jsmind';
import 'jsmind/style/jsmind.css';

const { TextArea } = Input;

// 修改内容展示组件
const SummaryContent = React.memo(({ fileId, content, isLoading }) => {
    const containerId = `summary-content-${fileId}`;

    // 直接使用传入的 content，不再使用本地状态
    return (
        <div key={fileId} id={containerId} className="markdown-content">
            <ReactMarkdown>{content || ''}</ReactMarkdown>
        </div>
    );
});

const DetailedSummaryContent = React.memo(({ fileId, content, isLoading }) => {
    const containerId = `detailed-summary-content-${fileId}`;

    return (
        <div key={fileId} id={containerId} className="markdown-content detailed-summary-content">
            <ReactMarkdown>{content || ''}</ReactMarkdown>
        </div>
    );
});

const MindmapContent = React.memo(({ fileId, content, isLoading }) => {
    const containerId = `mindmap-container-${fileId}`;

    useEffect(() => {
        if (content && !isLoading) {
            const container = document.getElementById(containerId);
            if (!container) return;

            // 清空容器
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            try {
                const options = {
                    container: containerId,
                    theme: 'primary',
                    editable: false,
                    view: {
                        hmargin: 100,
                        vmargin: 50,
                        line_width: 2,
                        line_color: '#558B2F'
                    },
                    layout: {
                        hspace: 30,
                        vspace: 20,
                        pspace: 13
                    }
                };

                const jm = new jsMind(options);
                const data = typeof content === 'string'
                    ? JSON.parse(content)
                    : content;

                jm.show(data);
            } catch (error) {
                console.error('Failed to render mindmap:', error);
                container.innerHTML = '<div class="mindmap-error">思维导图渲染失败</div>';
            }
        }
    }, [content, isLoading, containerId, fileId]);

    // 如果正在加载，显示加载提示
    if (isLoading) {
        return (
            <div id={containerId} className="mindmap-container">
                <div className="mindmap-loading">
                    <div className="loading-spinner"></div>
                    <p>正在生成思维导图...</p>
                </div>
            </div>
        );
    }

    // 如果有内容，显示思维导图容器
    if (content) {
        return <div key={fileId} id={containerId} className="mindmap-container" />;
    }

    // 如果既不是加载中也没有内容，返回空容器
    return <div id={containerId} className="mindmap-container" />;
});

const ResultFileSelector = React.memo(({ files, selectedIds, onToggle, onMove }) => {
    if (files.length === 0) {
        return (
            <div className="empty-state">
                <p>暂无转录结果文件</p>
            </div>
        );
    }

    const selectedSet = new Set(selectedIds);
    const orderedFiles = [
        ...selectedIds.map(id => files.find(file => file.id === id)).filter(Boolean),
        ...files.filter(file => !selectedSet.has(file.id)),
    ];

    return (
        <div className="result-selector">
            <div className="result-selector-list">
                {orderedFiles.map(file => {
                    const selectedIndex = selectedIds.indexOf(file.id);
                    const isSelected = selectedIndex !== -1;
                    return (
                        <div key={file.id} className={`result-selector-item ${isSelected ? 'selected' : ''}`}>
                            <Checkbox
                                checked={isSelected}
                                onChange={(e) => onToggle(file.id, e.target.checked)}
                            >
                                {file.name}
                            </Checkbox>
                            <div className="result-selector-actions">
                                <Button
                                    size="small"
                                    icon={<ArrowUpOutlined />}
                                    disabled={!isSelected || selectedIndex === 0}
                                    onClick={() => onMove(file.id, 'up')}
                                    type="text"
                                    aria-label="上移"
                                    title="上移"
                                />
                                <Button
                                    size="small"
                                    icon={<ArrowDownOutlined />}
                                    disabled={!isSelected || selectedIndex === selectedIds.length - 1}
                                    onClick={() => onMove(file.id, 'down')}
                                    type="text"
                                    aria-label="下移"
                                    title="下移"
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

const ChatMessages = React.memo(({ messages, onCopy }) => (
    <div className="chat-messages">
        {messages.map((msg, index) => (
            <div
                key={index}
                className={`message-wrapper ${msg.role === 'user' ? 'user' : 'assistant'}`}
            >
                <div className="message-bubble">
                    <div className="message-content">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    <Button
                        type="text"
                        className="copy-button"
                        icon={<CopyOutlined />}
                        onClick={() => onCopy(msg.content)}
                    >
                        复制
                    </Button>
                </div>
                <div className="message-time">
                    {new Date().toLocaleTimeString()}
                </div>
            </div>
        ))}
    </div>
));

const ResizableTitle = (props) => {
    const { onResize, width, children, ...restProps } = props;
    if (!width) {
        return <th {...restProps}>{children}</th>;
    }
    return (
        <th {...restProps} style={{ ...restProps.style, width }}>
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <div style={{ paddingRight: 8 }}>{children}</div>
                <span
                    onMouseDown={onResize}
                    style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        height: '100%',
                        width: 6,
                        cursor: 'col-resize',
                        userSelect: 'none',
                    }}
                />
            </div>
        </th>
    );
};

function App() {
    const [summary, setSummary] = useState('');
    // eslint-disable-next-line no-unused-vars
    const [mindmap, setMindmap] = useState('');
    const [messagesByFile, setMessagesByFile] = useState({});
    const [inputMessages, setInputMessages] = useState({});
    const [mediaUrl, setMediaUrl] = useState(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isMindmapLoading, setIsMindmapLoading] = useState(false);
    const mediaRef = useRef(null);
    const [detailedSummary, setDetailedSummary] = useState('');
    const [generatingFiles, setGeneratingFiles] = useState(new Set());
    const abortControllers = useRef({});
    const jmInstanceRef = useRef(null);
    const loadedChatKeysRef = useRef(new Set());
    const [uploadedFiles, setUploadedFiles] = useState([]);  // 存储上传的文件列表
    const [selectedFiles, setSelectedFiles] = useState([]);  // 存储选中的文件
    const [currentFile, setCurrentFile] = useState(null);    // 当前预览的文件
    const [resultSelection, setResultSelection] = useState([]);
    const [pageSize, setPageSize] = useState(5); // 默认每页显示5个文件
    const [currentPage, setCurrentPage] = useState(1); // 添加当前页码状态
    const [abortTranscribing, setAbortTranscribing] = useState(false); // 添加停止转录状态
    const [mindmapLoadingFiles, setMindmapLoadingFiles] = useState(new Set());
    const [summaryLoadingFiles, setSummaryLoadingFiles] = useState(new Set());
    const [detailedSummaryLoadingFiles, setDetailedSummaryLoadingFiles] = useState(new Set());
    const [mergedSummary, setMergedSummary] = useState('');
    const [mergedDetailedSummary, setMergedDetailedSummary] = useState('');
    const [mergedMindmapData, setMergedMindmapData] = useState(null);
    const [mergedSummaryLoading, setMergedSummaryLoading] = useState(false);
    const [mergedDetailedSummaryLoading, setMergedDetailedSummaryLoading] = useState(false);
    const [mergedMindmapLoading, setMergedMindmapLoading] = useState(false);
    const [collapsedTranscriptions, setCollapsedTranscriptions] = useState(new Set());
    const [now, setNow] = useState(Date.now());
    const averageSpeedRef = useRef({ totalFactor: 0, count: 0 });
    const emptyMessagesRef = useRef([]);
    const [fileColumnWidths, setFileColumnWidths] = useState({
        name: 420,
        type: 120,
        duration: 120,
        status: 160,
        remaining: 160,
        action: 100,
    });

    // 打印 uploadedFiles 的变化
    useEffect(() => {
        console.log('Uploaded Files:', uploadedFiles);
    }, [uploadedFiles]);

    useEffect(() => {
        const loadFiles = async () => {
            try {
                const response = await fetch('http://localhost:8000/api/files');
                if (!response.ok) {
                    throw new Error('加载文件列表失败');
                }
                const data = await response.json();
                const files = (data.files || []).map(file => ({
                    ...file,
                    transcribeStartAt: null,
                    transcribeProgress: null,
                    transcribeProgressCurrent: null,
                    transcribeProgressDuration: null,
                    transcribeElapsed: typeof file.transcribeElapsed === 'number' ? file.transcribeElapsed : null,
                }));
                setUploadedFiles(files);
                if (files.length > 0 && !currentFile) {
                    setCurrentFile(files[0]);
                    setMediaUrl({ url: files[0].url, type: files[0].type });
                }
            } catch (error) {
                console.error('Failed to load files:', error);
            }
        };
        loadFiles();
    }, []);

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const transcribingIds = uploadedFiles.filter(file => file.status === 'transcribing').map(file => file.id);
    const transcribingKey = transcribingIds.join('|');

    useEffect(() => {
        if (!transcribingKey) {
            return;
        }
        let stopped = false;
        const fetchProgress = async () => {
            const ids = transcribingKey.split('|').filter(Boolean);
            if (ids.length === 0) {
                return;
            }
            await Promise.all(ids.map(async (fileId) => {
                try {
                    const response = await fetch(`http://localhost:8000/api/files/${fileId}/transcribe-progress`);
                    if (!response.ok) {
                        return;
                    }
                    const data = await response.json();
                    if (stopped) {
                        return;
                    }
                    const progressValue = typeof data.progress === 'number' ? data.progress : null;
                    const currentValue = typeof data.current === 'number' ? data.current : null;
                    const durationValue = typeof data.duration === 'number' ? data.duration : null;
                    setUploadedFiles(prev => prev.map(file => file.id === fileId ? {
                        ...file,
                        transcribeProgress: progressValue,
                        transcribeProgressCurrent: currentValue,
                        transcribeProgressDuration: durationValue,
                    } : file));
                    setCurrentFile(prev => prev?.id === fileId ? {
                        ...prev,
                        transcribeProgress: progressValue,
                        transcribeProgressCurrent: currentValue,
                        transcribeProgressDuration: durationValue,
                    } : prev);
                } catch (error) {
                }
            }));
        };
        fetchProgress();
        const timer = setInterval(fetchProgress, 1000);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [transcribingKey]);

    // 初始化 Mermaid
    React.useEffect(() => {
        Mermaid.initialize({
            startOnLoad: true,
            theme: 'default',
            securityLevel: 'loose',
            mindmap: {
                padding: 20,
                curve: 'basis',
                nodeSpacing: 100,
                rankSpacing: 80,
                fontSize: 14,
                wrap: true,
                useMaxWidth: true
            },
            themeVariables: {
                mindmapNode: '#7CB342',
                mindmapNodeBorder: '#558B2F',
                mindmapHover: '#AED581',
                mindmapBorder: '#558B2F',
                primaryColor: '#7CB342',
                lineColor: '#558B2F',
                textColor: '#37474F'
            }
        });
    }, []);

    const hasTranscription = (file) => file?.transcription && file.transcription.length > 0;

    const areArraysEqual = (left, right) => {
        if (left.length !== right.length) return false;
        return left.every((value, index) => value === right[index]);
    };

    useEffect(() => {
        const transcribedIds = uploadedFiles.filter(hasTranscription).map(file => file.id);
        setResultSelection(prev => {
            const existing = prev.filter(id => transcribedIds.includes(id));
            if (existing.length > 0) {
                return areArraysEqual(existing, prev) ? prev : existing;
            }
            if (currentFile && transcribedIds.includes(currentFile.id)) {
                const nextSelection = [currentFile.id];
                return areArraysEqual(prev, nextSelection) ? prev : nextSelection;
            }
            const nextSelection = transcribedIds.length > 0 ? [transcribedIds[0]] : [];
            return areArraysEqual(prev, nextSelection) ? prev : nextSelection;
        });
    }, [uploadedFiles, currentFile]);

    const mergedSelectionKey = resultSelection.join('|');
    const mergedChatKey = mergedSelectionKey ? `merged:${mergedSelectionKey}` : '';

    useEffect(() => {
        setMergedSummary('');
        setMergedDetailedSummary('');
        setMergedMindmapData(null);
        if (!mergedSelectionKey) {
            return;
        }
        fetch(`http://localhost:8000/api/merged-summary/${encodeURIComponent(mergedSelectionKey)}`)
            .then(response => {
                if (!response.ok) {
                    return null;
                }
                return response.json();
            })
            .then(data => {
                if (data?.summary) {
                    setMergedSummary(data.summary);
                }
            })
            .catch(() => {});
        fetch(`http://localhost:8000/api/merged-detailed-summary/${encodeURIComponent(mergedSelectionKey)}`)
            .then(response => {
                if (!response.ok) {
                    return null;
                }
                return response.json();
            })
            .then(data => {
                if (data?.summary) {
                    setMergedDetailedSummary(data.summary);
                }
            })
            .catch(() => {});
        fetch(`http://localhost:8000/api/merged-mindmap/${encodeURIComponent(mergedSelectionKey)}`)
            .then(response => {
                if (!response.ok) {
                    return null;
                }
                return response.json();
            })
            .then(data => {
                if (data?.mindmap) {
                    setMergedMindmapData(data.mindmap);
                }
            })
            .catch(() => {});
    }, [mergedSelectionKey]);

    const handleUpload = async (file) => {
        // 检查文件类型
        const isVideo = file.type.startsWith('video/');
        const isAudio = file.type.startsWith('audio/');

        if (!isVideo && !isAudio) {
            message.error('请上传视频或音频文件');
            return false;
        }

        // 检查文件是否已经存在
        const isExist = uploadedFiles.some(f => f.name === file.name && (f.fileSize || 0) === file.size);
        if (isExist) {
            message.warning('文件已存在');
            return false;
        }

        try {
            const formData = new FormData();
            formData.append('file', file, file.name);

            const response = await fetch('http://localhost:8000/api/files/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('上传失败');
            }

            const uploadResult = await response.json();
            if (uploadResult?.skipped) {
                message.info('文件已存在，已跳过上传');
                return false;
            }
            const newFile = uploadResult?.file ? uploadResult.file : uploadResult;
            newFile.transcribeStartAt = null;

            setUploadedFiles(prev => [...prev, newFile]);

            const mediaElement = document.createElement(isVideo ? 'video' : 'audio');
            mediaElement.preload = 'metadata';
            mediaElement.src = newFile.url;
            mediaElement.onloadedmetadata = () => {
                const duration = Number.isFinite(mediaElement.duration) ? mediaElement.duration : 0;
                setUploadedFiles(prev => prev.map(f => f.id === newFile.id ? { ...f, duration } : f));
                if (currentFile?.id === newFile.id) {
                    setCurrentFile(prev => prev ? { ...prev, duration } : prev);
                }
            };
            mediaElement.onerror = () => {
                setUploadedFiles(prev => prev.map(f => f.id === newFile.id ? { ...f, duration: 0 } : f));
            };

            // 如果是第一个文件，动设置为当前预览文件
            if (uploadedFiles.length === 0) {
                setCurrentFile(newFile);
                setMediaUrl({ url: newFile.url, type: newFile.type });
            }
        } catch (error) {
            console.error('Upload failed:', error);
            message.error('上传失败：' + error.message);
        }

        return false; // 阻止自动上传
    };

    // 处理文件选择
    const handleFileSelect = (fileIds) => {
        setSelectedFiles(fileIds);
    };

    // 添加分页配置
    const paginationConfig = {
        current: currentPage, // 当前页码
        pageSize: pageSize,
        showSizeChanger: true,
        pageSizeOptions: ['5', '10', '20', '50'],
        showTotal: (total) => `共 ${total} 个文件`,
        onChange: (page, size) => {
            setCurrentPage(page); // 更新当前页码
            setPageSize(size); // 更新每页显示数量
        },
        onShowSizeChange: (current, size) => {
            setCurrentPage(1); // 切换每页显示数量时重置为第一页
            setPageSize(size);
        },
    };

    // 计算当前页应该显示的文件
    const getPageData = () => {
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        return uploadedFiles.slice(start, end);
    };

    const formatDuration = (seconds) => {
        const safeSeconds = Math.max(0, Math.floor(seconds || 0));
        const hours = Math.floor(safeSeconds / 3600);
        const minutes = Math.floor((safeSeconds % 3600) / 60);
        const secs = Math.floor(safeSeconds % 60);

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const getAverageSpeedFactor = () => {
        const { totalFactor, count } = averageSpeedRef.current;
        return count > 0 ? totalFactor / count : 1;
    };

    const getEstimatedTotalSeconds = (file) => {
        if (!file?.duration || file.duration <= 0) return null;
        return file.duration * getAverageSpeedFactor();
    };

    const getTranscribingRemainingSeconds = (file) => {
        if (file?.transcribeProgressDuration != null && file?.transcribeProgressCurrent != null) {
            return Math.max(file.transcribeProgressDuration - file.transcribeProgressCurrent, 0);
        }
        const total = getEstimatedTotalSeconds(file);
        if (!total || !file?.transcribeStartAt) return null;
        const elapsed = (now - file.transcribeStartAt) / 1000;
        return Math.max(total - elapsed, 0);
    };

    const getQueueRemainingSeconds = (targetFile) => {
        if (!selectedFiles.includes(targetFile.id)) return null;
        let remaining = 0;
        const currentTranscribing = uploadedFiles.find(f => f.status === 'transcribing');
        const currentRemaining = currentTranscribing ? getTranscribingRemainingSeconds(currentTranscribing) : null;
        for (const id of selectedFiles) {
            const file = uploadedFiles.find(f => f.id === id);
            if (!file) continue;
            if (id === targetFile.id) {
                const ownTotal = getEstimatedTotalSeconds(file);
                return ownTotal == null ? null : remaining + ownTotal;
            }
            if (file.status === 'done' || file.status === 'error') continue;
            if (file.status === 'transcribing') {
                if (currentRemaining != null) remaining += currentRemaining;
            } else if (file.status === 'waiting' || file.status === 'interrupted') {
                const total = getEstimatedTotalSeconds(file);
                if (total != null) remaining += total;
            }
        }
        return null;
    };

    // 文件列表列定
    const fileColumns = [
        {
            title: '文件名',
            dataIndex: 'name',
            key: 'name',
            width: fileColumnWidths.name,
        },
        {
            title: '类型',
            dataIndex: 'type',
            key: 'type',
            width: fileColumnWidths.type,
            render: (type) => type === 'video' ? '视频' : '音频',
        },
        {
            title: '耗时',
            dataIndex: 'duration',
            key: 'duration',
            width: fileColumnWidths.duration,
            render: (duration, record) => {
                if (record.status === 'transcribing' && record.transcribeStartAt) {
                    const elapsedSeconds = Math.max((now - record.transcribeStartAt) / 1000, 0);
                    return formatDuration(elapsedSeconds);
                }
                if (record.transcribeElapsed != null) {
                    return formatDuration(record.transcribeElapsed);
                }
                return '—';
            },
        },
        {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: fileColumnWidths.status,
            render: (status, record) => {
                switch (status) {
                    case 'waiting': return '等待转录';
                    case 'transcribing': {
                        const progress = typeof record?.transcribeProgress === 'number'
                            ? `${Math.min(100, Math.max(0, Math.round(record.transcribeProgress)))}%`
                            : '';
                        return <><SyncOutlined spin /> 转录中{progress ? ` ${progress}` : ''}</>;
                    }
                    case 'done': return <span style={{ color: '#52c41a' }}>已完成</span>;
                    case 'error': return <span style={{ color: '#ff4d4f' }}>失败</span>;
                    case 'interrupted': return <span style={{ color: '#faad14' }}>转录中断</span>;
                    default: return status;
                }
            },
        },
        {
            title: '预计剩余',
            key: 'remaining',
            width: fileColumnWidths.remaining,
            render: (_, record) => {
                if (record.status === 'done') return '已完成';
                if (record.status === 'error') return '—';
                if (record.status === 'transcribing') {
                    const remaining = getTranscribingRemainingSeconds(record);
                    return remaining == null ? '计算中' : formatDuration(Math.ceil(remaining));
                }
                if (record.status === 'waiting' || record.status === 'interrupted') {
                    if (!selectedFiles.includes(record.id)) return '—';
                    const queueRemaining = getQueueRemainingSeconds(record);
                    return queueRemaining == null ? '计算中' : formatDuration(Math.ceil(queueRemaining));
                }
                return '—';
            },
        },
        {
            title: '操作',
            key: 'action',
            width: fileColumnWidths.action,
            render: (_, record) => (
                <Button
                    type="text"
                    danger
                    onClick={(e) => {
                        e.stopPropagation();
                        handleFileDelete(record.id);
                    }}
                    icon={<DeleteOutlined />}
                    disabled={record.status === 'transcribing'}
                >
                    删除
                </Button>
            ),
        },
    ].map((column) => ({
        ...column,
        onHeaderCell: () => ({
            width: column.width,
            onResize: (event) => {
                event.preventDefault();
                event.stopPropagation();
                const startX = event.clientX;
                const startWidth = fileColumnWidths[column.key] || 120;
                const onMouseMove = (moveEvent) => {
                    const nextWidth = Math.max(80, startWidth + moveEvent.clientX - startX);
                    setFileColumnWidths((prev) => ({ ...prev, [column.key]: nextWidth }));
                };
                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            },
        }),
    }));

    // 处理文件删除
    const handleFileDelete = (fileId) => {
        const removeLocal = () => {
            setUploadedFiles(prev => prev.filter(file => file.id !== fileId));
            setSelectedFiles(prev => prev.filter(id => id !== fileId));

            if (currentFile?.id === fileId) {
                const remainingFiles = uploadedFiles.filter(file => file.id !== fileId);
                const nextFile = remainingFiles[0];
                if (nextFile) {
                    setCurrentFile(nextFile);
                    setMediaUrl({ url: nextFile.url, type: nextFile.type });
                } else {
                    setCurrentFile(null);
                    setMediaUrl(null);
                }
            }
        };

        fetch(`http://localhost:8000/api/files/${fileId}`, { method: 'DELETE' })
            .then(() => removeLocal())
            .catch((error) => {
                console.error('Failed to delete file:', error);
                message.error('删除失败：' + error.message);
            });
    };

    // 修改文件预览函数
    const handleFilePreview = (file) => {
        const currentFileRef = uploadedFiles.find(f => f.id === file.id);
        setCurrentFile(currentFileRef);
        setMediaUrl({ url: file.url, type: file.type });
    };

    // 修改批量转录函数
    const handleBatchTranscribe = async () => {
        if (isTranscribing) {
            setIsTranscribing(false);  // 立即更新状态
            setAbortTranscribing(true);

            try {
                const response = await fetch('http://localhost:8000/api/stop-transcribe', {
                    method: 'POST',
                });

                if (!response.ok) {
                    throw new Error('停止转录失败');
                }

                // 只将正在转录的文件状态改为中断
                setUploadedFiles(prev => prev.map(f =>
                    f.status === 'transcribing'
                        ? {
                            ...f,
                            status: 'interrupted',
                            transcribeStartAt: null,
                            transcribeProgress: null,
                            transcribeProgressCurrent: null,
                            transcribeProgressDuration: null,
                            transcribeElapsed: f.transcribeStartAt ? Math.max((Date.now() - f.transcribeStartAt) / 1000, 0) : f.transcribeElapsed ?? null,
                        }
                        : f
                ));
                setCurrentFile(prev => prev?.status === 'transcribing' ? {
                    ...prev,
                    status: 'interrupted',
                    transcribeStartAt: null,
                    transcribeProgress: null,
                    transcribeProgressCurrent: null,
                    transcribeProgressDuration: null,
                    transcribeElapsed: prev?.transcribeStartAt ? Math.max((Date.now() - prev.transcribeStartAt) / 1000, 0) : prev?.transcribeElapsed ?? null,
                } : prev);

                message.success('已停止转录');
            } catch (error) {
                console.error('Failed to stop transcription:', error);
                message.error('停止转录失败：' + error.message);
            } finally {
                setAbortTranscribing(false);
            }
            return;
        }

        if (selectedFiles.length === 0) {
            message.warning('请选需要转录的文件');
            return;
        }

        setIsTranscribing(true);
        setAbortTranscribing(false);
        message.loading('开始转录选中的文件...', 0);

        try {
            for (const fileId of selectedFiles) {
                // 检查是否已经请求中断
                if (abortTranscribing) {
                    // 只将当前在转的文件状态改为中断
                    setUploadedFiles(prev => prev.map(f =>
                    f.status === 'transcribing'
                        ? {
                            ...f,
                            status: 'interrupted',
                            transcribeStartAt: null,
                            transcribeProgress: null,
                            transcribeProgressCurrent: null,
                            transcribeProgressDuration: null,
                            transcribeElapsed: f.transcribeStartAt ? Math.max((Date.now() - f.transcribeStartAt) / 1000, 0) : f.transcribeElapsed ?? null,
                        }
                            : f
                    ));
                setCurrentFile(prev => prev?.status === 'transcribing' ? {
                    ...prev,
                    status: 'interrupted',
                    transcribeStartAt: null,
                    transcribeProgress: null,
                    transcribeProgressCurrent: null,
                    transcribeProgressDuration: null,
                    transcribeElapsed: prev?.transcribeStartAt ? Math.max((Date.now() - prev.transcribeStartAt) / 1000, 0) : prev?.transcribeElapsed ?? null,
                } : prev);
                    break;
                }

                const file = uploadedFiles.find(f => f.id === fileId);
                if (!file) continue;

                // 修改这里：只跳过已完成的文件，允许中断状态的文件重新转录
                if (file.status === 'done') {
                    message.info(`文件 "${file.name}" 已经转录完成，跳过此文件。`);
                    continue;
                }

                // 更新文件状态为转录中
                setUploadedFiles(prev => prev.map(f =>
                    f.id === fileId ? {
                        ...f,
                        status: 'transcribing',
                        transcribeStartAt: Date.now(),
                        transcribeProgress: 0,
                        transcribeProgressCurrent: 0,
                        transcribeProgressDuration: null,
                        transcribeElapsed: null,
                    } : f
                ));

                try {
                    const response = await fetch(`http://localhost:8000/api/files/${fileId}/transcribe`, {
                        method: 'POST',
                    });

                    const data = await response.json();

                    if (response.status === 499) {
                        // 处理转录中断的情况，只更新当前文件状态
                        setUploadedFiles(prev => prev.map(f =>
                            f.id === fileId
                                ? {
                                    ...f,
                                    status: 'interrupted',
                                    transcribeStartAt: null,
                                    transcribeProgress: null,
                                    transcribeProgressCurrent: null,
                                    transcribeProgressDuration: null,
                                    transcribeElapsed: f.transcribeStartAt ? Math.max((Date.now() - f.transcribeStartAt) / 1000, 0) : f.transcribeElapsed ?? null,
                                }
                                : f
                        ));
                        break; // 中断后续文件的转录
                    }

                    if (!response.ok) {
                        throw new Error(`转录失败: ${file.name}`);
                    }

                    if (!abortTranscribing) {  // 添加检查，确保没有中断请求
                        if (file?.transcribeStartAt && file.duration) {
                            const elapsedSeconds = (Date.now() - file.transcribeStartAt) / 1000;
                            if (elapsedSeconds > 0) {
                                averageSpeedRef.current = {
                                    totalFactor: averageSpeedRef.current.totalFactor + (elapsedSeconds / file.duration),
                                    count: averageSpeedRef.current.count + 1
                                };
                            }
                        }
                        setUploadedFiles(prev => {
                            const newFiles = prev.map(f =>
                                f.id === fileId ? {
                                    ...f,
                                    status: 'done',
                                    transcription: data.transcription,
                                    transcribeStartAt: null,
                                    transcribeProgress: 100,
                                    transcribeProgressCurrent: f.transcribeProgressDuration ?? f.duration ?? f.transcribeProgressCurrent ?? null,
                                    transcribeProgressDuration: f.transcribeProgressDuration ?? f.duration ?? null,
                                    transcribeElapsed: f.transcribeStartAt ? Math.max((Date.now() - f.transcribeStartAt) / 1000, 0) : f.transcribeElapsed ?? null,
                                } : f
                            );
                            return newFiles;
                        });

                        if (currentFile?.id === fileId) {
                            setCurrentFile(prev => ({
                                ...prev,
                                status: 'done',
                                transcription: data.transcription,
                                transcribeStartAt: null,
                                transcribeProgress: 100,
                                transcribeProgressCurrent: prev?.transcribeProgressDuration ?? prev?.duration ?? prev?.transcribeProgressCurrent ?? null,
                                transcribeProgressDuration: prev?.transcribeProgressDuration ?? prev?.duration ?? null,
                                transcribeElapsed: prev?.transcribeStartAt ? Math.max((Date.now() - prev.transcribeStartAt) / 1000, 0) : prev?.transcribeElapsed ?? null,
                            }));
                        }
                    }
                } catch (error) {
                    if (!abortTranscribing) {  // 添加检查，确保没有中断请求
                        setUploadedFiles(prev => prev.map(f =>
                            f.id === fileId ? {
                                ...f,
                                status: 'error',
                                transcribeStartAt: null,
                                transcribeProgress: null,
                                transcribeProgressCurrent: null,
                                transcribeProgressDuration: null,
                                transcribeElapsed: f.transcribeStartAt ? Math.max((Date.now() - f.transcribeStartAt) / 1000, 0) : f.transcribeElapsed ?? null,
                            } : f
                        ));
                        message.error(`文件 "${file.name}" 转录失败：${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.error('Transcription failed:', error);
            message.error('转录失败：' + error.message);
        } finally {
            setIsTranscribing(false);
            setAbortTranscribing(false);
            message.destroy();
        }
    };

    // 检查是否有转录结果的函数
    const checkTranscription = (file) => {
        if (!hasTranscription(file)) {
            message.warning('需等待视频/音频完成转录');
            return false;
        }
        return true;
    };

    // 修改简单总结函数
    const handleSummary = async (fileId) => {
        const file = uploadedFiles.find(f => f.id === fileId);
        if (!file) return;
        if (!checkTranscription(file)) return;

        if (summaryLoadingFiles.has(fileId)) {
            message.warning('该文件正在生成总结，请稍候');
            return;
        }

        try {
            setSummaryLoadingFiles(prev => new Set([...prev, fileId]));

            // 找到文件在 uploadedFiles 中的引用
            const fileRef = uploadedFiles.find(f => f.id === fileId);
            if (!fileRef) return;

            // 初始化内容
            fileRef.summary = '';
            // 强制更新 uploadedFiles 以触发重渲染
            setUploadedFiles([...uploadedFiles]);

            const response = await fetch(`http://localhost:8000/api/files/${fileId}/summary`, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error('生成总结失败');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let summaryText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                summaryText += chunk;

                // 直接更新文件引用中的内容
                fileRef.summary = summaryText;
                // 强制更新 uploadedFiles 以触发重渲染
                setUploadedFiles([...uploadedFiles]);
                setCurrentFile(fileRef);
            }

        } catch (error) {
            console.error('Summary generation failed:', error);
            message.error('生成总结失败：' + error.message);
        } finally {
            setSummaryLoadingFiles(prev => {
                const newSet = new Set(prev);
                newSet.delete(fileId);
                return newSet;
            });
        }
    };

    // 修改生成思维导图的函数
    const handleMindmap = async (fileId) => {
        const file = uploadedFiles.find(f => f.id === fileId);
        if (!file) return;
        if (!checkTranscription(file)) return;

        // 检查当前文件是否正在生成思维导图
        if (mindmapLoadingFiles.has(fileId)) {
            message.warning('该文件正在生成思维导图，请稍候');
            return;
        }

        try {
            // 将当前文件添加到正在生成的集合中
            setMindmapLoadingFiles(prev => new Set([...prev, fileId]));

            // 找到文件在 uploadedFiles 中的引用
            const fileRef = uploadedFiles.find(f => f.id === fileId);
            if (!fileRef) return;

            // 初始化内容
            fileRef.mindmapData = null;
            // 强制更新 uploadedFiles 以触发重渲染
            setUploadedFiles([...uploadedFiles]);

            const response = await fetch(`http://localhost:8000/api/files/${fileId}/mindmap`, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error('生成思维导图失败');
            }

            const data = await response.json();

            // 更新文件对象中的思维导图数据
            fileRef.mindmapData = data.mindmap;
            // 强制更新 uploadedFiles 以触发重渲染
            setUploadedFiles([...uploadedFiles]);

        } catch (error) {
            console.error('Failed to generate mindmap:', error);
            message.error('生成思维导图失败：' + error.message);
        } finally {
            // 从正在生成的集合中移除当前文件
            setMindmapLoadingFiles(prev => {
                const newSet = new Set(prev);
                newSet.delete(fileId);
                return newSet;
            });
        }
    };

    // 在组件卸载时清理
    useEffect(() => {
        return () => {
            if (jmInstanceRef.current) {
                jmInstanceRef.current = null;
            }
        };
    }, []);

    // 修改 jsMind 的初始化和主题注册
    useEffect(() => {
        // 创建自定义主题
        const customTheme = {
            'background': '#fff',
            'color': '#333',

            'main-color': '#333',
            'main-radius': '4px',
            'main-background-color': '#f0f2f5',
            'main-padding': '10px',
            'main-margin': '0px',
            'main-font-size': '16px',
            'main-font-weight': 'bold',

            'sub-color': '#333',
            'sub-radius': '4px',
            'sub-background-color': '#fff',
            'sub-padding': '8px',
            'sub-margin': '0px',
            'sub-font-size': '14px',
            'sub-font-weight': 'normal',

            'line-width': '2px',
            'line-color': '#558B2F',
        };

        // 册主和样式
        if (jsMind.hasOwnProperty('register_theme')) {
            jsMind.register_theme('primary', customTheme);
        } else if (jsMind.hasOwnProperty('util') && jsMind.util.hasOwnProperty('register_theme')) {
            jsMind.util.register_theme('primary', customTheme);
        }

        // 注册节点式
        const nodeStyles = {
            important: {
                'background-color': '#e6f7ff',
                'border-radius': '4px',
                'padding': '4px 8px',
                'border': '1px solid #91d5ff'
            }
        };

        if (jsMind.hasOwnProperty('register_node_style')) {
            Object.keys(nodeStyles).forEach(style => {
                jsMind.register_node_style(style, nodeStyles[style]);
            });
        } else if (jsMind.hasOwnProperty('util') && jsMind.util.hasOwnProperty('register_node_style')) {
            Object.keys(nodeStyles).forEach(style => {
                jsMind.util.register_node_style(style, nodeStyles[style]);
            });
        }
    }, []);

    const persistChatHistory = async (contextKey, messages) => {
        if (!contextKey) return;
        try {
            await fetch('http://localhost:8000/api/chat-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contextKey, messages }),
            });
        } catch (error) {}
    };

    const loadChatHistory = async (contextKey) => {
        if (!contextKey || loadedChatKeysRef.current.has(contextKey)) return;
        try {
            const response = await fetch(`http://localhost:8000/api/chat-history/${encodeURIComponent(contextKey)}`);
            loadedChatKeysRef.current.add(contextKey);
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            if (Array.isArray(data?.messages)) {
                setMessagesByFile(prev => ({ ...prev, [contextKey]: data.messages }));
            }
        } catch (error) {
            loadedChatKeysRef.current.add(contextKey);
        }
    };

    useEffect(() => {
        if (mergedChatKey) {
            loadChatHistory(mergedChatKey);
        }
        resultSelection.forEach(id => {
            loadChatHistory(id);
        });
    }, [mergedChatKey, resultSelection]);

    // 修改发送消息函数
    const handleSendMessage = async (targetId, contextText) => {
        const file = contextText ? null : uploadedFiles.find(f => f.id === targetId);
        if (!contextText && !file) return;

        if (generatingFiles.has(targetId)) {
            abortControllers.current[targetId]?.abort();
            setGeneratingFiles(prev => {
                const next = new Set(prev);
                next.delete(targetId);
                return next;
            });
            const currentMessages = messagesByFile[targetId] || [];
            let updatedMessages = currentMessages;
            if (currentMessages.length > 0) {
                const lastIndex = currentMessages.length - 1;
                const lastMessage = currentMessages[lastIndex];
                if (lastMessage.role === 'assistant') {
                    updatedMessages = [
                        ...currentMessages.slice(0, lastIndex),
                        {
                            ...lastMessage,
                            content: `${lastMessage.content}\n\n*[已停止生成]*`
                        }
                    ];
                }
            }
            setMessagesByFile(prev => ({ ...prev, [targetId]: updatedMessages }));
            persistChatHistory(targetId, updatedMessages);
            return;
        }

        if (!contextText && !checkTranscription(file)) return;
        const inputMessage = inputMessages[targetId] || '';
        if (!inputMessage.trim()) {
            message.warning('请输入消息内容');
            return;
        }

        const newMessage = { role: 'user', content: inputMessage };
        const currentMessages = [...(messagesByFile[targetId] || []), newMessage];
        setMessagesByFile(prev => ({ ...prev, [targetId]: currentMessages }));
        setInputMessages(prev => ({ ...prev, [targetId]: '' }));
        setGeneratingFiles(prev => new Set([...prev, targetId]));

        abortControllers.current[targetId] = new AbortController();

        try {
            const response = await fetch('http://localhost:8000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: currentMessages,
                    context: contextText || file.transcription.map(item => item.text).join('\n'),
                }),
                signal: abortControllers.current[targetId].signal
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const reader = response.body.getReader();
            let aiResponse = '';

            setMessagesByFile(prev => ({
                ...prev,
                [targetId]: [...currentMessages, { role: 'assistant', content: '' }]
            }));

            while (true) {
                try {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = new TextDecoder().decode(value);
                    aiResponse += chunk;

                    setMessagesByFile(prev => ({
                        ...prev,
                        [targetId]: [...currentMessages, { role: 'assistant', content: aiResponse }]
                    }));
                } catch (error) {
                    if (error.name === 'AbortError') {
                        // 在被中断时立即退出循环
                        break;
                    }
                    throw error;
                }
            }
            const finalMessages = [...currentMessages, { role: 'assistant', content: aiResponse }];
            setMessagesByFile(prev => ({
                ...prev,
                [targetId]: finalMessages
            }));
            await persistChatHistory(targetId, finalMessages);
        } catch (error) {
            if (error.name === 'AbortError') {
                message.info('已停止生成');
            } else {
                console.error('Error sending message:', error);
                message.error('发送消息失败：' + error.message);
            }
        } finally {
            setGeneratingFiles(prev => {
                const next = new Set(prev);
                next.delete(targetId);
                return next;
            });
            delete abortControllers.current[targetId];
        }
    };

    // 添加时点转函数
    const handleTimeClick = (time) => {
        if (mediaRef.current) {
            mediaRef.current.currentTime = time;
            mediaRef.current.play();
        }
    };

    // 添加时间格式化函数
    const formatTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // 定义表格列
    const transcriptionColumns = [
        {
            title: '时间点',
            dataIndex: 'time',
            key: 'time',
            width: '30%',
            render: (_, record) => (
                <Button
                    type="link"
                    onClick={() => handleTimeClick(record.start)}
                    style={{ padding: 0 }}
                >
                    [{formatTime(record.start)} - {formatTime(record.end)}]
                </Button>
            ),
        },
        {
            title: '内容',
            dataIndex: 'text',
            key: 'text',
        },
    ];

    // 修改导出函数
    const handleExport = async (format, fileIds = resultSelection) => {
        if (fileIds.length === 0) {
            message.warning('请选择需要导出的文件');
            return;
        }

        try {
            // 显示导进度
            message.loading('正在导出选中的文件...', 0);

            // 遍历选中的文件
            for (const fileId of fileIds) {
                const file = uploadedFiles.find(f => f.id === fileId);

                // 检查文件是否有转录结果
                if (!file || !hasTranscription(file)) {
                    message.warning(`文件 "${file?.name}" 没有转录结果，已跳过`);
                    continue;
                }

                try {
                    const response = await fetch(`http://localhost:8000/api/export/${format}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(file.transcription),
                    });

                    if (!response.ok) {
                        throw new Error(`导出失败: ${file.name}`);
                    }

                    // 获取文件名
                    const contentDisposition = response.headers.get('content-disposition');
                    let filename = `${file.name.replace(/\.[^/.]+$/, '')}_transcription.${format}`;
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                        if (filenameMatch) {
                            filename = filenameMatch[1];
                        }
                    }

                    // 下载文件
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    message.success(`文件 "${file.name}" 导出成功`);
                } catch (error) {
                    message.error(`文件 "${file.name}" 导出失败：${error.message}`);
                }
            }
        } catch (error) {
            console.error('Export failed:', error);
            message.error('导出失败：' + error.message);
        } finally {
            message.destroy(); // 清除loading息
        }
    };

    // 修改详细总结函数
    const handleDetailedSummary = async (fileId) => {
        const file = uploadedFiles.find(f => f.id === fileId);
        if (!file) return;
        if (!checkTranscription(file)) return;

        if (detailedSummaryLoadingFiles.has(fileId)) {
            message.warning('该文件正在生成详细总结，请稍候');
            return;
        }

        try {
            setDetailedSummaryLoadingFiles(prev => new Set([...prev, fileId]));

            // 找到文件在 uploadedFiles 中的引用
            const fileRef = uploadedFiles.find(f => f.id === fileId);
            if (!fileRef) return;

            // 初始化内容
            fileRef.detailedSummary = '';
            // 强制更新 uploadedFiles 以触发重渲染
            setUploadedFiles([...uploadedFiles]);

            const response = await fetch(`http://localhost:8000/api/files/${fileId}/detailed-summary`, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error('生成详细总结失败');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let summaryText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                summaryText += chunk;

                // 直接更新文件引用中的内容
                fileRef.detailedSummary = summaryText;
                // 强制更新 uploadedFiles 以触发重渲染
                setUploadedFiles([...uploadedFiles]);
            }

        } catch (error) {
            console.error('Detailed summary generation failed:', error);
            message.error('生成详细总结失败：' + error.message);
        } finally {
            setDetailedSummaryLoadingFiles(prev => {
                const newSet = new Set(prev);
                newSet.delete(fileId);
                return newSet;
            });
        }
    };

    const handleMergedSummary = async () => {
        if (mergedTranscribedFiles.length === 0) {
            message.warning('请选择需要合并的转录结果文件');
            return;
        }
        if (mergedSummaryLoading) {
            message.warning('合并总结正在生成，请稍候');
            return;
        }

        try {
            setMergedSummaryLoading(true);
            setMergedSummary('');

            const response = await fetch('http://localhost:8000/api/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: mergedText }),
            });

            if (!response.ok) {
                throw new Error('生成合并总结失败');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let summaryText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                summaryText += chunk;
                setMergedSummary(summaryText);
            }
            if (mergedSelectionKey && summaryText) {
                fetch('http://localhost:8000/api/merged-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ selectionKey: mergedSelectionKey, summary: summaryText }),
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Merged summary generation failed:', error);
            message.error('生成合并总结失败：' + error.message);
        } finally {
            setMergedSummaryLoading(false);
        }
    };

    const handleMergedDetailedSummary = async () => {
        if (mergedTranscribedFiles.length === 0) {
            message.warning('请选择需要合并的转录结果文件');
            return;
        }
        if (mergedDetailedSummaryLoading) {
            message.warning('合并详细总结正在生成，请稍候');
            return;
        }

        try {
            setMergedDetailedSummaryLoading(true);
            setMergedDetailedSummary('');

            const response = await fetch('http://localhost:8000/api/detailed-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: mergedText }),
            });

            if (!response.ok) {
                throw new Error('生成合并详细总结失败');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let summaryText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                summaryText += chunk;
                setMergedDetailedSummary(summaryText);
            }
            if (mergedSelectionKey && summaryText) {
                fetch('http://localhost:8000/api/merged-detailed-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ selectionKey: mergedSelectionKey, summary: summaryText }),
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Merged detailed summary generation failed:', error);
            message.error('生成合并详细总结失败：' + error.message);
        } finally {
            setMergedDetailedSummaryLoading(false);
        }
    };

    const handleMergedMindmap = async () => {
        if (mergedTranscribedFiles.length === 0) {
            message.warning('请选择需要合并的转录结果文件');
            return;
        }
        if (mergedMindmapLoading) {
            message.warning('合并思维导图正在生成，请稍候');
            return;
        }

        try {
            setMergedMindmapLoading(true);
            setMergedMindmapData(null);

            const response = await fetch('http://localhost:8000/api/mindmap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: mergedText }),
            });

            if (!response.ok) {
                throw new Error('生成合并思维导图失败');
            }

            const data = await response.json();
            setMergedMindmapData(data.mindmap);
            if (mergedSelectionKey && data?.mindmap) {
                fetch('http://localhost:8000/api/merged-mindmap', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ selectionKey: mergedSelectionKey, mindmap: data.mindmap }),
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Merged mindmap generation failed:', error);
            message.error('生成合并思维导图失败：' + error.message);
        } finally {
            setMergedMindmapLoading(false);
        }
    };

    // 添加导出总结函数
    const handleExportSummary = async (summaryText, type = 'summary') => {
        if (!summaryText) {
            message.warning('没有可导出的内容');
            return;
        }

        try {
            const response = await fetch(`http://localhost:8000/api/export/summary`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(summaryText),
            });

            if (!response.ok) {
                throw new Error('导出失败');
            }

            // 下载文件
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${type}_${new Date().toISOString().slice(0, 10)}.md`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            message.success('导出成功');
        } catch (error) {
            console.error('Export failed:', error);
            message.error('导出失败：' + error.message);
        }
    };

    // 添加复制功能
    const handleCopyMessage = useCallback((content) => {
        navigator.clipboard.writeText(content)
            .then(() => {
                message.success('复制成功');
            })
            .catch(() => {
                message.error('复制失败');
            });
    }, []);

    // 添加全部删除的处理函数
    const handleDeleteAll = () => {
        if (selectedFiles.length === 0) {
            message.warning('请选择需要删除的文件');
            return;
        }

        Promise.all(
            selectedFiles.map(fileId =>
                fetch(`http://localhost:8000/api/files/${fileId}`, { method: 'DELETE' })
            )
        )
            .then(() => {
                setUploadedFiles(prev => prev.filter(file => !selectedFiles.includes(file.id)));
                setSelectedFiles([]);

                if (currentFile && selectedFiles.includes(currentFile.id)) {
                    const remainingFiles = uploadedFiles.filter(file => !selectedFiles.includes(file.id));
                    const nextFile = remainingFiles[0];
                    if (nextFile) {
                        setCurrentFile(nextFile);
                        setMediaUrl({ url: nextFile.url, type: nextFile.type });
                    } else {
                        setCurrentFile(null);
                        setMediaUrl(null);
                    }
                }

                message.success('已删除选中的文件');
            })
            .catch((error) => {
                console.error('Failed to delete files:', error);
                message.error('删除失败：' + error.message);
            });
    };

    const transcribedFiles = uploadedFiles.filter(hasTranscription);
    const mergedTranscribedFiles = resultSelection
        .map(id => uploadedFiles.find(file => file.id === id))
        .filter(file => file && hasTranscription(file));
    const mergedMessages = messagesByFile[mergedChatKey] || emptyMessagesRef.current;

    const buildMergedText = (files) => {
        if (files.length === 0) return '';
        return files.map(file => {
            const text = file.transcription.map(item => item.text).join('\n');
            return `# 文件：${file.name}\n${text}`;
        }).join('\n\n');
    };

    const mergedText = buildMergedText(mergedTranscribedFiles);
    const mergedIdSuffix = mergedSelectionKey ? mergedSelectionKey.split('|').join('-') : 'empty';

    const handleToggleResultSelection = (id, checked) => {
        setResultSelection(prev => {
            const next = [...prev];
            const idx = next.indexOf(id);
            if (checked && idx === -1) next.push(id);
            if (!checked && idx !== -1) next.splice(idx, 1);
            return next;
        });
    };

    const handleMoveResultSelection = (id, direction) => {
        setResultSelection(prev => {
            const next = [...prev];
            const idx = next.indexOf(id);
            if (idx === -1) return next;
            const target = direction === 'up' ? idx - 1 : idx + 1;
            if (target < 0 || target >= next.length) return next;
            const [item] = next.splice(idx, 1);
            next.splice(target, 0, item);
            return next;
        });
    };

    const toggleTranscriptionCollapse = (fileId) => {
        setCollapsedTranscriptions(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) {
                next.delete(fileId);
            } else {
                next.add(fileId);
            }
            return next;
        });
    };

    // 修改标签页内容
    const tabItems = [
        {
            key: '1',
            label: '转录结果',
            children: (
                <div className="tab-content">
                    <div className="export-section">
                        <div className="selection-tip">
                            {resultSelection.length > 0 && (
                                <span>已选择 {resultSelection.length} 个转录文件</span>
                            )}
                        </div>
                        <div className="export-buttons">
                            <Button.Group size="small">
                                <Button
                                    onClick={() => handleExport('vtt')}
                                    icon={<DownloadOutlined />}
                                    disabled={resultSelection.length === 0}
                                >
                                    VTT
                                </Button>
                                <Button
                                    onClick={() => handleExport('srt')}
                                    icon={<DownloadOutlined />}
                                    disabled={resultSelection.length === 0}
                                >
                                    SRT
                                </Button>
                                <Button
                                    onClick={() => handleExport('txt')}
                                    icon={<DownloadOutlined />}
                                    disabled={resultSelection.length === 0}
                                >
                                    TXT
                                </Button>
                            </Button.Group>
                        </div>
                    </div>
                    <ResultFileSelector
                        files={transcribedFiles}
                        selectedIds={resultSelection}
                        onToggle={handleToggleResultSelection}
                        onMove={handleMoveResultSelection}
                    />
                    {resultSelection.length === 0 ? (
                        <div className="empty-state">
                            <p>请选择要展示的转录结果文件</p>
                        </div>
                    ) : (
                        resultSelection.map(fid => {
                            const file = uploadedFiles.find(f => f.id === fid);
                            if (!file || !hasTranscription(file)) return null;
                            return (
                                <Card key={fid} style={{ marginTop: 8 }}>
                                    <div className="current-file-tip" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
                                        <Button
                                            size="small"
                                            type="text"
                                            onClick={() => toggleTranscriptionCollapse(fid)}
                                        >
                                            {collapsedTranscriptions.has(fid) ? '展开' : '折叠'}
                                        </Button>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                                            文件：{file.name}
                                        </span>
                                    </div>
                                    {!collapsedTranscriptions.has(fid) && (
                                        <Table
                                            dataSource={file.transcription.map((item, index) => ({
                                                ...item,
                                                key: index,
                                            }))}
                                            columns={transcriptionColumns}
                                            pagination={false}
                                            size="small"
                                        />
                                    )}
                                </Card>
                            );
                        })
                    )}
                </div>
            ),
        },
        {
            key: '2',
            label: '简单总结',
            children: (
                <div className="tab-content">
                    <ResultFileSelector
                        files={transcribedFiles}
                        selectedIds={resultSelection}
                        onToggle={handleToggleResultSelection}
                        onMove={handleMoveResultSelection}
                    />
                    {resultSelection.length === 0 ? (
                        <div className="empty-state">
                            <p>请选择要展示的转录结果文件</p>
                        </div>
                    ) : (
                        <>
                            <Card style={{ marginTop: 8 }}>
                                <div className="current-file-tip">
                                    <span>合并结果（{mergedTranscribedFiles.length} 个文件）</span>
                                </div>
                                <div className="button-group">
                                    <Button
                                        onClick={handleMergedSummary}
                                        loading={mergedSummaryLoading}
                                        disabled={mergedTranscribedFiles.length === 0 || mergedSummaryLoading}
                                    >
                                        {mergedSummaryLoading ? '生成中...' : '合并生成总结'}
                                    </Button>
                                    <Button
                                        onClick={() => handleExportSummary(mergedSummary, 'merged_summary')}
                                        icon={<DownloadOutlined />}
                                        disabled={!mergedSummary}
                                    >
                                        导出合并总结
                                    </Button>
                                </div>
                                {!mergedSummary && !mergedSummaryLoading ? (
                                    <div className="empty-state">
                                        <p>点击上方按钮生成合并总结</p>
                                    </div>
                                ) : (
                                    <SummaryContent
                                        fileId={`merged-summary-${mergedIdSuffix}`}
                                        content={mergedSummary}
                                        isLoading={mergedSummaryLoading}
                                    />
                                )}
                            </Card>
                            {resultSelection.map(fid => {
                                const file = uploadedFiles.find(f => f.id === fid);
                                if (!file || !hasTranscription(file)) return null;
                                const loading = summaryLoadingFiles.has(fid);
                                return (
                                    <Card key={fid} style={{ marginTop: 8 }}>
                                        <div className="current-file-tip">
                                            <span>文件：{file.name}</span>
                                        </div>
                                        <div className="button-group">
                                            <Button
                                                onClick={() => handleSummary(fid)}
                                                loading={loading}
                                                disabled={!hasTranscription(file) || loading}
                                            >
                                                {loading ? '生成中...' : '生成总结'}
                                            </Button>
                                            <Button
                                                onClick={() => handleExportSummary(file.summary)}
                                                icon={<DownloadOutlined />}
                                                disabled={!file.summary}
                                            >
                                                导出总结
                                            </Button>
                                        </div>
                                        {!file.summary && !loading ? (
                                            <div className="empty-state">
                                                <p>点击上方按钮生成简单总结</p>
                                            </div>
                                        ) : (
                                            <SummaryContent
                                                fileId={fid}
                                                content={file.summary}
                                                isLoading={loading}
                                            />
                                        )}
                                    </Card>
                                );
                            })}
                        </>
                    )}
                </div>
            ),
        },
        {
            key: '3',
            label: '详细总结',
            children: (
                <div className="tab-content">
                    <ResultFileSelector
                        files={transcribedFiles}
                        selectedIds={resultSelection}
                        onToggle={handleToggleResultSelection}
                        onMove={handleMoveResultSelection}
                    />
                    {resultSelection.length === 0 ? (
                        <div className="empty-state">
                            <p>请选择要展示的转录结果文件</p>
                        </div>
                    ) : (
                        <>
                            <Card style={{ marginTop: 8 }}>
                                <div className="current-file-tip">
                                    <span>合并结果（{mergedTranscribedFiles.length} 个文件）</span>
                                </div>
                                <div className="button-group">
                                    <Button
                                        onClick={handleMergedDetailedSummary}
                                        loading={mergedDetailedSummaryLoading}
                                        disabled={mergedTranscribedFiles.length === 0 || mergedDetailedSummaryLoading}
                                    >
                                        {mergedDetailedSummaryLoading ? '生成中...' : '合并生成详细总结'}
                                    </Button>
                                    <Button
                                        onClick={() => handleExportSummary(mergedDetailedSummary, 'merged_detailed_summary')}
                                        icon={<DownloadOutlined />}
                                        disabled={!mergedDetailedSummary}
                                    >
                                        导出合并总结
                                    </Button>
                                </div>
                                {!mergedDetailedSummary && !mergedDetailedSummaryLoading ? (
                                    <div className="empty-state">
                                        <p>点击上方按钮生成合并详细总结</p>
                                    </div>
                                ) : (
                                    <DetailedSummaryContent
                                        fileId={`merged-detailed-summary-${mergedIdSuffix}`}
                                        content={mergedDetailedSummary}
                                        isLoading={mergedDetailedSummaryLoading}
                                    />
                                )}
                            </Card>
                            {resultSelection.map(fid => {
                                const file = uploadedFiles.find(f => f.id === fid);
                                if (!file || !hasTranscription(file)) return null;
                                const loading = detailedSummaryLoadingFiles.has(fid);
                                return (
                                    <Card key={fid} style={{ marginTop: 8 }}>
                                        <div className="current-file-tip">
                                            <span>文件：{file.name}</span>
                                        </div>
                                        <div className="button-group">
                                            <Button
                                                onClick={() => handleDetailedSummary(fid)}
                                                loading={loading}
                                                disabled={!hasTranscription(file) || loading}
                                            >
                                                {loading ? '生成中...' : '生成详细总结'}
                                            </Button>
                                            <Button
                                                onClick={() => handleExportSummary(file?.detailedSummary, 'detailed_summary')}
                                                icon={<DownloadOutlined />}
                                                disabled={!file?.detailedSummary}
                                            >
                                                导出总结
                                            </Button>
                                        </div>
                                        {!file.detailedSummary && !loading ? (
                                            <div className="empty-state">
                                                <p>点击上方按钮生成详细总结</p>
                                            </div>
                                        ) : (
                                            <DetailedSummaryContent
                                                fileId={fid}
                                                content={file.detailedSummary}
                                                isLoading={loading}
                                            />
                                        )}
                                    </Card>
                                );
                            })}
                        </>
                    )}
                </div>
            ),
        },
        {
            key: '4',
            label: '思维导图',
            children: (
                <div className="tab-content">
                    <ResultFileSelector
                        files={transcribedFiles}
                        selectedIds={resultSelection}
                        onToggle={handleToggleResultSelection}
                        onMove={handleMoveResultSelection}
                    />
                    {resultSelection.length === 0 ? (
                        <div className="empty-state">
                            <p>请选择要展示的转录结果文件</p>
                        </div>
                    ) : (
                        <>
                            <Card style={{ marginTop: 8 }}>
                                <div className="current-file-tip">
                                    <span>合并结果（{mergedTranscribedFiles.length} 个文件）</span>
                                </div>
                                <div className="button-group">
                                    <Button
                                        onClick={handleMergedMindmap}
                                        loading={mergedMindmapLoading}
                                        disabled={mergedTranscribedFiles.length === 0 || mergedMindmapLoading}
                                    >
                                        {mergedMindmapLoading ? '生成中...' : '合并生成思维导图'}
                                    </Button>
                                </div>
                                {!mergedMindmapData && !mergedMindmapLoading ? (
                                    <div className="empty-state">
                                        <p>点击上方按钮生成合并思维导图</p>
                                    </div>
                                ) : (
                                    <MindmapContent
                                        fileId={`merged-mindmap-${mergedIdSuffix}`}
                                        content={mergedMindmapData}
                                        isLoading={mergedMindmapLoading}
                                    />
                                )}
                            </Card>
                            {resultSelection.map(fid => {
                                const file = uploadedFiles.find(f => f.id === fid);
                                if (!file || !hasTranscription(file)) return null;
                                const loading = mindmapLoadingFiles.has(fid);
                                return (
                                    <Card key={fid} style={{ marginTop: 8 }}>
                                        <div className="current-file-tip">
                                            <span>文件：{file.name}</span>
                                        </div>
                                        <div className="button-group">
                                            <Button
                                                onClick={() => handleMindmap(fid)}
                                                loading={loading}
                                                disabled={!hasTranscription(file) || loading}
                                            >
                                                {loading ? '生成中...' : '生成思维导图'}
                                            </Button>
                                        </div>
                                        {!file.mindmapData && !loading ? (
                                            <div className="empty-state">
                                                <p>点击上方按钮生成思维导图</p>
                                            </div>
                                        ) : (
                                            <MindmapContent
                                                fileId={fid}
                                                content={file.mindmapData}
                                                isLoading={loading}
                                            />
                                        )}
                                    </Card>
                                );
                            })}
                        </>
                    )}
                </div>
            ),
        },
        {
            key: '5',
            label: '对话交互',
            children: (
                <div className="tab-content chat-tab">
                    <ResultFileSelector
                        files={transcribedFiles}
                        selectedIds={resultSelection}
                        onToggle={handleToggleResultSelection}
                        onMove={handleMoveResultSelection}
                    />
                    {resultSelection.length === 0 ? (
                        <div className="empty-state">
                            <p>请选择要展示的转录结果文件</p>
                        </div>
                    ) : (
                        <>
                            <Card style={{ marginTop: 8 }}>
                                <div className="current-file-tip">
                                    <span>合并结果（{mergedTranscribedFiles.length} 个文件）</span>
                                </div>
                                <ChatMessages messages={mergedMessages} onCopy={handleCopyMessage} />
                                <div className="chat-input-area">
                                    <TextArea
                                        value={inputMessages[mergedChatKey] || ''}
                                        onChange={e => setInputMessages(prev => ({ ...prev, [mergedChatKey]: e.target.value }))}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                if (mergedTranscribedFiles.length > 0) {
                                                    handleSendMessage(mergedChatKey, mergedText);
                                                }
                                            }
                                        }}
                                        placeholder="输入消息按Enter发送，Shift+Enter换行"
                                        autoSize={{ minRows: 1, maxRows: 4 }}
                                        disabled={mergedTranscribedFiles.length === 0 || generatingFiles.has(mergedChatKey)}
                                    />
                                    <Button
                                        type="primary"
                                        icon={generatingFiles.has(mergedChatKey) ? <StopOutlined /> : <SendOutlined />}
                                        onClick={() => handleSendMessage(mergedChatKey, mergedText)}
                                        danger={generatingFiles.has(mergedChatKey)}
                                        disabled={mergedTranscribedFiles.length === 0}
                                    >
                                        {generatingFiles.has(mergedChatKey) ? '停止' : '发送'}
                                    </Button>
                                </div>
                            </Card>
                            {resultSelection.map(fid => {
                                const file = uploadedFiles.find(f => f.id === fid);
                                if (!file || !hasTranscription(file)) return null;
                                const messages = messagesByFile[fid] || emptyMessagesRef.current;
                                const inputVal = inputMessages[fid] || '';
                                const generating = generatingFiles.has(fid);
                                return (
                                    <Card key={fid} style={{ marginTop: 8 }}>
                                        <div className="current-file-tip">
                                            <span>文件：{file.name}</span>
                                        </div>
                                        <ChatMessages messages={messages} onCopy={handleCopyMessage} />
                                        <div className="chat-input-area">
                                            <TextArea
                                                value={inputVal}
                                                onChange={e => setInputMessages(prev => ({ ...prev, [fid]: e.target.value }))}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleSendMessage(fid);
                                                    }
                                                }}
                                                placeholder="输入消息按Enter发送，Shift+Enter换行"
                                                autoSize={{ minRows: 1, maxRows: 4 }}
                                                disabled={generating}
                                            />
                                            <Button
                                                type="primary"
                                                icon={generating ? <StopOutlined /> : <SendOutlined />}
                                                onClick={() => handleSendMessage(fid)}
                                                danger={generating}
                                            >
                                                {generating ? '停止' : '发送'}
                                            </Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </>
                    )}
                </div>
            ),
        },
    ];

    // 修改左侧标签页内容
    const leftTabItems = [
        {
            key: '1',
            label: '音视频预览',
            children: (
                <div className="tab-content">
                    <div className="preview-section">
                        {mediaUrl ? (
                            <div className="media-preview">
                                {mediaUrl.type === 'video' ? (
                                    <div className="video-container">
                                        <video
                                            ref={mediaRef}
                                            src={mediaUrl.url}
                                            controls
                                            className="video-player"
                                        />
                                    </div>
                                ) : (
                                    <div className="audio-container">
                                        <div className="audio-placeholder">
                                            <SoundOutlined style={{ fontSize: '24px' }} />
                                            <span>音频文件</span>
                                        </div>
                                        <audio
                                            ref={mediaRef}
                                            src={mediaUrl.url}
                                            controls
                                            className="audio-player"
                                        />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="upload-placeholder">
                                <div className="placeholder-content">
                                    <div className="placeholder-icon">
                                        <UploadOutlined style={{ fontSize: '48px', color: '#999' }} />
                                    </div>
                                    <p>等待上传本地文件</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="file-list-section">
                        <div className="section-header">
                            <div className="section-title">
                                <h3>文件列表</h3>
                            </div>
                            <div className="action-buttons">
                                <Button
                                    onClick={() => {
                                        const allFileIds = uploadedFiles.map(file => file.id);
                                        setSelectedFiles(allFileIds);
                                    }}
                                >
                                    全选
                                </Button>
                                <Button
                                    onClick={() => setSelectedFiles([])}
                                >
                                    取消全选
                                </Button>
                                <Button
                                    type="primary"
                                    danger
                                    onClick={handleDeleteAll}
                                    disabled={selectedFiles.length === 0 || selectedFiles.some(id =>
                                        uploadedFiles.find(f => f.id === id)?.status === 'transcribing'
                                    )}
                                >
                                    删除选中
                                </Button>
                                <Button
                                    type="primary"
                                    onClick={handleBatchTranscribe}
                                    disabled={selectedFiles.length === 0}
                                    danger={isTranscribing}
                                >
                                    {isTranscribing ? '停止转录' : '开始转录'}
                                </Button>
                            </div>
                        </div>
                        <Table
                            components={{
                                header: {
                                    cell: ResizableTitle,
                                },
                            }}
                            tableLayout="fixed"
                            rowSelection={{
                                selectedRowKeys: selectedFiles,
                                onChange: handleFileSelect,
                                preserveSelectedRowKeys: true,
                            }}
                            dataSource={getPageData()} // 使用分页后的数据
                            columns={fileColumns}
                            rowKey="id"
                            size="small"
                            onRow={(record) => ({
                                onClick: () => handleFilePreview(record),
                                style: {
                                    cursor: 'pointer',
                                    background: currentFile?.id === record.id ? '#e6f7ff' : 'inherit',
                                },
                            })}
                            pagination={false}
                        />
                        <div className="pagination-container">
                            <Pagination
                                {...paginationConfig}
                                total={uploadedFiles.length}
                            />
                        </div>
                    </div>
                </div>
            ),
        },
    ];

    return (
        <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
            <div className="app-header" style={{ background: '#fff' }}>
                <div className="title">
                    <h1 style={{ color: '#000' }}>VideoChat：一键总结视频与音频内容｜帮助解读的 AI 助手</h1>
                </div>
                <div className="header-right">
                    <a
                        href="https://github.com/Airmomo/VideoChat"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="github-link"
                    >
                        <GithubOutlined />
                        <span className="author-info">By Airmomo</span>
                    </a>
                </div>
                <div className="upload-section">
                    <Upload
                        beforeUpload={handleUpload}
                        accept="video/*,audio/*"
                        showUploadList={false}
                        multiple={true}
                        directory={false}
                    >
                        <Button icon={<UploadOutlined />}>
                            上传本地文件
                        </Button>
                    </Upload>
                </div>
                <div className="support-text">
                    支持多个视频和音频文件格式
                </div>
            </div>

            <div className="app-content">
                <div className="main-layout">
                    <div className="media-panel">
                        <Card className="media-card">
                            <Tabs items={leftTabItems} />
                        </Card>
                    </div>

                    <div className="feature-panel">
                        <Card className="feature-card">
                            <Tabs items={tabItems} />
                        </Card>
                    </div>
                </div>
            </div>
        </Layout>
    );
}

export default App;
