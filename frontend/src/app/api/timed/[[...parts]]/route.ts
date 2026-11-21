import { NextRequest } from "next/server";
import { relayLabRequest } from "@/lib/lab-room/relay-server";
export const dynamic="force-dynamic";
export function GET(request:NextRequest,{params}:{params:{parts?:string[]}}){return relayLabRequest(request,"timed",params.parts);}
export const POST=GET;
