import { promises as fs } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 读取文件内容
 * @param filePath 文件路径（相对于workspace）
 * @param workspace 工作空间路径
 * @returns 文件内容
 */
export async function readFile(filePath: string, workspace: string): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
        // 验证路径安全性，防止路径遍历攻击
        const fullPath = resolve(join(workspace, filePath));
        
        // 检查是否尝试访问敏感系统目录
        if (isSensitivePath(fullPath)) {
            throw new Error('Access denied: Attempting to access sensitive system directory');
        }
        
        // 检查路径是否在工作空间内
        if (!fullPath.startsWith(resolve(workspace))) {
            throw new Error('Access denied: Path traversal detected');
        }
        
        const content = await fs.readFile(fullPath, 'utf-8');
        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 写入文件内容
 * @param filePath 文件路径（相对于workspace）
 * @param content 文件内容
 * @param workspace 工作空间路径
 * @returns 操作结果
 */
export async function writeFile(filePath: string, content: string, workspace: string): Promise<{ success: boolean; error?: string }> {
    try {
        // 验证路径安全性，防止路径遍历攻击
        const fullPath = resolve(join(workspace, filePath));
        
        // 检查是否尝试访问敏感系统目录
        if (isSensitivePath(fullPath)) {
            throw new Error('Access denied: Attempting to access sensitive system directory');
        }
        
        // 检查路径是否在工作空间内
        if (!fullPath.startsWith(resolve(workspace))) {
            throw new Error('Access denied: Path traversal detected');
        }
        
        // 确保目录存在
        const dirPath = dirname(fullPath);
        await fs.mkdir(dirPath, { recursive: true });
        
        await fs.writeFile(fullPath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 列出目录内容
 * @param dirPath 目录路径（相对于workspace）
 * @param workspace 工作空间路径
 * @returns 目录内容列表
 */
export async function listDir(dirPath: string = '.', workspace: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    try {
        // 验证路径安全性
        const fullPath = resolve(join(workspace, dirPath));
        
        // 检查是否尝试访问敏感系统目录
        if (isSensitivePath(fullPath)) {
            throw new Error('Access denied: Attempting to access sensitive system directory');
        }
        
        // 检查路径是否在工作空间内
        if (!fullPath.startsWith(resolve(workspace))) {
            throw new Error('Access denied: Path traversal detected');
        }
        
        const files = await fs.readdir(fullPath);
        return { success: true, files };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 获取工作空间路径
 * @param workspace 工作空间路径
 * @returns 工作空间路径
 */
export function getWorkspace(workspace: string): string {
    return workspace;
}

/**
 * 检查路径是否指向敏感系统目录
 * @param path 路径
 * @returns 是否为敏感路径
 */
function isSensitivePath(path: string): boolean {
    const sensitivePaths = [
        '/etc',
        '/etc/',
        '/var',
        '/var/',
        '/usr',
        '/usr/',
        '/root',
        '/root/',
        '/home/root',
        '/home/root/',
        '/proc',
        '/proc/',
        '/sys',
        '/sys/',
        '/tmp',
        '/tmp/'  // 虽然/tmp是临时目录，但出于安全考虑，限制对它的访问
    ];
    
    return sensitivePaths.some(sensitive => 
        path === sensitive || path.startsWith(sensitive + '/')
    );
}