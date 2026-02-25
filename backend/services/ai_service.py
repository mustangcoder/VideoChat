from openai import AsyncOpenAI
import os
from typing import List, AsyncGenerator, Dict, Any
from backend.models import ChatMessage
from backend.config import AI_CONFIG
import json
import aiohttp

# 配置OpenAI
client = AsyncOpenAI(
    base_url=AI_CONFIG["base_url"],
    api_key=AI_CONFIG["api_key"]
)

# async def generate_summary(text: str):
#     response = await client.chat.completions.create(
#         model=AI_CONFIG["model"],
#         messages=[
#             {"role": "system", "content": "请对以下内容进行总结："},
#             {"role": "user", "content": text}
#         ],
#         stream=False,
#         max_tokens=1024
#     )
#
#     async for chunk in response:
#         if chunk.choices[0].delta.content is not None:
#             yield chunk.choices[0].delta.content

async def generate_summary(text: str) -> AsyncGenerator[str, None]:
    """
    改造后的文本摘要生成函数，使用 aiohttp 直接调用 OpenAI API
    输入：需要总结的文本
    输出：异步生成器，返回摘要内容
    """
    # 1. 构建 API 请求的核心参数
    api_url = f"{AI_CONFIG['base_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AI_CONFIG['api_key']}"
    }
    # 构建摘要专用的消息列表，包含系统提示和用户文本
    payload = {
        "model": AI_CONFIG["model"],
        "messages": [
            {"role": "system", "content": "这是一位资深的基金经理的直播内容，要着重关注其中关于股票、投资相关的内容，请对以下内容进行总结："},
            {"role": "user", "content": text}
        ],
        "stream": False,  # 非流式响应
        "max_tokens": 4096  # 保留原有的 token 限制
    }

    # 2. 发送异步 HTTP 请求并处理响应
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(api_url, headers=headers, json=payload) as response:
                # 检查请求是否成功
                if response.status != 200:
                    error_info = await response.text()
                    raise Exception(f"摘要生成请求失败 (状态码: {response.status}): {error_info}")

                # 解析 JSON 响应
                response_data = await response.json()

                # 3. 提取摘要内容并按原格式 yield
                if (
                        response_data.get("choices")
                        and len(response_data["choices"]) > 0
                        and "message" in response_data["choices"][0]
                ):
                    summary_content = response_data["choices"][0]["message"]["content"]
                    yield summary_content  # 非流式响应直接返回完整摘要

        except aiohttp.ClientError as e:
            raise Exception(f"网络请求错误：{str(e)}")
        except json.JSONDecodeError as e:
            raise Exception(f"响应解析失败：{str(e)}")
        except Exception as e:
            raise Exception(f"生成摘要时出错：{str(e)}")

# async def generate_mindmap(text: str) -> str:
#     try:
#         # 创建一个示例结构
#         example = {
#             "meta": {
#                 "name": "思维导图",
#                 "author": "AI",
#                 "version": "1.0"
#             },
#             "format": "node_tree",
#             "data": {
#                 "id": "root",
#                 "topic": "主题",
#                 "children": [
#                     {
#                         "id": "sub1",
#                         "topic": "子主题1",
#                         "direction": "left",
#                         "children": [
#                             {
#                                 "id": "sub1_1",
#                                 "topic": "细节1",
#                                 "direction": "left"
#                             }
#                         ]
#                     },
#                     {
#                         "id": "sub2",
#                         "topic": "子主题2",
#                         "direction": "right",
#                         "children": [
#                             {
#                                 "id": "sub2_1",
#                                 "topic": "细节2",
#                                 "direction": "right"
#                             }
#                         ]
#                     }
#                 ]
#             }
#         }
#
#         response = await client.chat.completions.create(
#             model=AI_CONFIG["model"],
#             messages=[
#                 {"role": "system", "content": f"""你是一个思维导图生成专家。请将内容转换为思维导图的 JSON 结构。
#                     要求：
#                     1. 必须严格按照示例格式生成 JSON
#                     2. JSON 必须包含 meta、format、data 三个顶级字段
#                     3. data 必须包含 id、topic、children 字段
#                     4. 第一层子节点必须指定 direction，左右交替分布
#                     5. 所有节点的 id 必须唯一
#                     6. 不要生成任何额外的说明文字，直接返回 JSON
#                     7. 确保生成的是有效的 JSON 格式
#
#                     示例结构：
#                     {json.dumps(example, ensure_ascii=False, indent=2)}
#
#                     请严格按照上述格式生成，不要添加任何其他内容。"""},
#                 {"role": "user", "content": text}
#             ],
#             stream=False,
#             temperature=0.7,
#             max_tokens=2000
#         )
#
#         full_response = response.choices[0].message.content.strip()
#
#         # 清理 AI 返回的内容
#         def clean_response(response_text: str) -> str:
#             # 移除 markdown 代码块标记
#             if response_text.startswith('```json'):
#                 response_text = response_text[7:]
#             elif response_text.startswith('```'):
#                 response_text = response_text[3:]
#
#             if response_text.endswith('```'):
#                 response_text = response_text[:-3]
#
#             # 确保返回的是去除首尾空白的字符串
#             return response_text.strip()
#
#         # 清理响应内容
#         cleaned_response = clean_response(full_response)
#
#         # 尝试解析 JSON
#         try:
#             mindmap_data = json.loads(cleaned_response)
#
#             # 验证数据结构
#             if not all(key in mindmap_data for key in ['meta', 'format', 'data']):
#                 raise ValueError("Missing required fields in mindmap data")
#
#             if not all(key in mindmap_data['data'] for key in ['id', 'topic']):
#                 raise ValueError("Missing required fields in mindmap data.data")
#
#             return json.dumps(mindmap_data, ensure_ascii=False)
#
#         except json.JSONDecodeError as e:
#             # 返回错误提示结构
#             error_mindmap = {
#                 "meta": {
#                     "name": "解析错误",
#                     "author": "System",
#                     "version": "1.0"
#                 },
#                 "format": "node_tree",
#                 "data": {
#                     "id": "root",
#                     "topic": "无法生成思维导图",
#                     "children": [
#                         {
#                             "id": "error",
#                             "topic": "生成失败，请重试",
#                             "direction": "right"
#                         }
#                     ]
#                 }
#             }
#             return json.dumps(error_mindmap, ensure_ascii=False)
#
#     except Exception as e:
#         print(f"错误类型: {type(e).__name__}")
#         print(f"错误信息: {str(e)}")
#         raise

async def generate_mindmap(text: str) -> str:
    try:
        # 1. 保留原有的示例思维导图结构
        example: Dict[str, Any] = {
            "meta": {
                "name": "思维导图",
                "author": "AI",
                "version": "1.0"
            },
            "format": "node_tree",
            "data": {
                "id": "root",
                "topic": "主题",
                "children": [
                    {
                        "id": "sub1",
                        "topic": "子主题1",
                        "direction": "left",
                        "children": [
                            {
                                "id": "sub1_1",
                                "topic": "细节1",
                                "direction": "left"
                            }
                        ]
                    },
                    {
                        "id": "sub2",
                        "topic": "子主题2",
                        "direction": "right",
                        "children": [
                            {
                                "id": "sub2_1",
                                "topic": "细节2",
                                "direction": "right"
                            }
                        ]
                    }
                ]
            }
        }

        # 2. 构建 API 请求参数
        api_url = f"{AI_CONFIG['base_url']}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AI_CONFIG['api_key']}"
        }

        # 保留原有的系统提示词（包含示例结构）
        system_prompt = f"""你是一个思维导图生成专家。请将内容转换为思维导图的 JSON 结构。
            要求：
            1. 必须严格按照示例格式生成 JSON
            2. JSON 必须包含 meta、format、data 三个顶级字段
            3. data 必须包含 id、topic、children 字段
            4. 第一层子节点必须指定 direction，左右交替分布
            5. 所有节点的 id 必须唯一
            6. 不要生成任何额外的说明文字，直接返回 JSON
            7. 确保生成的是有效的 JSON 格式

            示例结构：
            {json.dumps(example, ensure_ascii=False, indent=2)}

            请严格按照上述格式生成，不要添加任何其他内容。"""

        # 构建完整的请求体（保留所有原参数）
        payload = {
            "model": AI_CONFIG["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            "stream": False,
            "temperature": 0.5,
            "max_tokens": 2000
        }

        # 3. 发送异步 HTTP 请求
        async with aiohttp.ClientSession() as session:
            async with session.post(api_url, headers=headers, json=payload) as response:
                # 检查请求状态
                if response.status != 200:
                    error_detail = await response.text()
                    raise Exception(f"思维导图生成请求失败 (状态码: {response.status}): {error_detail}")

                # 解析响应数据
                response_data = await response.json()

                # 提取 AI 返回的内容（与原 SDK 逻辑一致）
                if not response_data.get("choices") or len(response_data["choices"]) == 0:
                    raise ValueError("API 响应中未找到有效内容")

                full_response = response_data["choices"][0]["message"]["content"].strip()

        # 4. 保留原有的内容清理逻辑
        def clean_response(response_text: str) -> str:
            # 移除 markdown 代码块标记
            if response_text.startswith('```json'):
                response_text = response_text[7:]
            elif response_text.startswith('```'):
                response_text = response_text[3:]

            if response_text.endswith('```'):
                response_text = response_text[:-3]

            # 确保返回的是去除首尾空白的字符串
            return response_text.strip()

        # 清理响应内容
        cleaned_response = clean_response(full_response)

        # 5. 保留原有的 JSON 解析和校验逻辑
        try:
            mindmap_data = json.loads(cleaned_response)

            # 验证数据结构
            if not all(key in mindmap_data for key in ['meta', 'format', 'data']):
                raise ValueError("Missing required fields in mindmap data")

            if not all(key in mindmap_data['data'] for key in ['id', 'topic']):
                raise ValueError("Missing required fields in mindmap data.data")

            return json.dumps(mindmap_data, ensure_ascii=False)

        except json.JSONDecodeError as e:
            # 返回错误提示结构（与原逻辑一致）
            error_mindmap = {
                "meta": {
                    "name": "解析错误",
                    "author": "System",
                    "version": "1.0"
                },
                "format": "node_tree",
                "data": {
                    "id": "root",
                    "topic": "无法生成思维导图",
                    "children": [
                        {
                            "id": "error",
                            "topic": "生成失败，请重试",
                            "direction": "right"
                        }
                    ]
                }
            }
            return json.dumps(error_mindmap, ensure_ascii=False)

    except Exception as e:
        # 保留原有的异常打印和抛出逻辑
        print(f"错误类型: {type(e).__name__}")
        print(f"错误信息: {str(e)}")
        raise

# async def chat_with_model(messages: List[ChatMessage], context: str):
#     # 将上下文添加到消息列表中
#     full_messages = [
#         {"role": "system", "content": f"以下是上下文信息：\n{context}\n请基于上述上下文回答用户的问题。"}
#     ]
#
#     for message in messages:
#         full_messages.append({
#             "role": message.role,
#             "content": message.content
#         })
#
#     response = await client.chat.completions.create(
#         model=AI_CONFIG["model"],
#         messages=full_messages,
#         stream=False
#     )
#
#     async for chunk in response:
#         if chunk.choices[0].delta.content is not None:
#             yield chunk.choices[0].delta.content

async def chat_with_model(messages: List[ChatMessage], context: str) -> AsyncGenerator[str, None]:
    """
    改造后的异步聊天函数，使用 aiohttp 直接调用 OpenAI API
    """
    # 1. 构建完整的消息列表
    full_messages = [
        {"role": "system", "content": f"以下是上下文信息：\n{context}\n请基于上述上下文回答用户的问题。"}
    ]

    for message in messages:
        full_messages.append({
            "role": message.role,
            "content": message.content
        })

    # 2. 构建 API 请求参数
    api_url = f"{AI_CONFIG['base_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AI_CONFIG['api_key']}"
    }
    payload = {
        "model": AI_CONFIG["model"],
        "messages": full_messages,
        "stream": False  # 保持非流式响应
    }

    # 3. 发送异步 HTTP 请求
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(api_url, headers=headers, json=payload) as response:
                # 检查响应状态
                if response.status != 200:
                    error_detail = await response.text()
                    raise Exception(f"API 请求失败 (状态码: {response.status}): {error_detail}")

                # 解析响应数据
                response_data = await response.json()

                # 4. 按原格式 yield 响应内容
                if response_data.get("choices") and len(response_data["choices"]) > 0:
                    content = response_data["choices"][0]["message"]["content"]
                    yield content  # 非流式响应直接返回完整内容

        except Exception as e:
            # 异常处理，可根据需要调整
            raise Exception(f"调用 OpenAI API 时出错: {str(e)}")

# async def generate_detailed_summary(text: str):
#     response = await client.chat.completions.create(
#         model=AI_CONFIG["model"],
#         messages=[
#             {"role": "system", "content": """请对以下内容进行详细的总结分析，要求：
#             1. 使用 Markdown 格式输出
#             2. 包含主要内容、关键点、背景信息等
#             3. 分点列出重要观点
#             4. 添加适当的标题和分隔符
#             5. 如有必要，可以添加��用和列表
#             """},
#             {"role": "user", "content": text}
#         ],
#         stream=True
#     )
#
#     async for chunk in response:
#         if chunk.choices[0].delta.content is not None:
#             yield chunk.choices[0].delta.content

async def generate_detailed_summary(text: str) -> AsyncGenerator[str, None]:
    """
    改造后的详细摘要生成函数（流式响应）
    输入：需要总结的文本
    输出：异步生成器，逐段返回 Markdown 格式的详细摘要内容
    """
    # 1. 构建 API 请求参数
    api_url = f"{AI_CONFIG['base_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AI_CONFIG['api_key']}"
    }

    # 完整保留原有的详细总结系统提示词（修复了原提示词中的乱码 "��" 为 "表"）
    system_prompt = """请对以下内容进行详细的总结分析，要求：
    1. 使用 Markdown 格式输出
    2. 包含主要内容、关键点、背景信息等
    3. 分点列出重要观点
    4. 添加适当的标题和分隔符
    5. 如有必要，可以添加表格和列表
    6. 这是一位资深的基金经理的直播内容，要着重关注其中关于股票、投资相关的内容
    """

    # 构建请求体（核心：stream=True 开启流式响应）
    payload = {
        "model": AI_CONFIG["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ],
        "stream": True  # 保留原函数的流式响应特性
    }

    # 2. 发送异步流式请求并处理响应
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(api_url, headers=headers, json=payload) as response:
                # 检查 HTTP 响应状态
                if response.status != 200:
                    error_detail = await response.text()
                    raise Exception(f"详细摘要请求失败 (状态码: {response.status}): {error_detail}")

                # 3. 逐行解析流式响应（SSE 格式）
                async for line in response.content:
                    # 解码并清理每行数据
                    line_str = line.decode('utf-8').strip()
                    # 跳过空行
                    if not line_str:
                        continue
                    # 处理 SSE 数据前缀（data: ...）
                    if line_str.startswith('data: '):
                        data = line_str[6:]  # 去掉 "data: " 前缀
                        # 流式响应结束标记
                        if data == '[DONE]':
                            break
                        # 解析 JSON 数据并提取内容
                        try:
                            chunk_data = json.loads(data)
                            # 提取流式返回的内容片段
                            if (
                                    chunk_data.get("choices")
                                    and len(chunk_data["choices"]) > 0
                            ):
                                delta_content = chunk_data["choices"][0]["delta"].get("content")
                                # 仅当内容不为空时 yield
                                if delta_content is not None:
                                    yield delta_content
                        except json.JSONDecodeError as e:
                            # 忽略解析失败的行（避免个别异常中断整体流程）
                            continue

        except aiohttp.ClientError as e:
            raise Exception(f"网络请求错误：{str(e)}")
        except Exception as e:
            raise Exception(f"生成详细摘要时出错：{str(e)}")