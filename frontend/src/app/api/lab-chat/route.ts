import { NextRequest } from "next/server";
import { relayLabRequest } from "@/lib/lab-room/relay-server";
export function POST(request:NextRequest){return relayLabRequest(request,"chat");}
